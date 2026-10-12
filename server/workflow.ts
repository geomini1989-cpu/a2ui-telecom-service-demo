import {randomUUID} from 'node:crypto';
import {Annotation, StateGraph, START, END, interrupt, Command} from '@langchain/langgraph';
import {runCoordinatorAgent, type CoordinatorResult} from './agent/coordinator.js';
import {planTurn, type PlanResult} from './planner.js';
import {routeAction, type TelecomAction} from './action-router.js';
import {orderSurface, resultSurface, findOrder} from './a2ui-builder.js';
import {TelecomStore, type Receipt} from './database.js';
import {NodeSqliteSaver} from './checkpointer.js';
import {pushHistory, sessionSnapshot, type TaskSession} from './session-store.js';
import {WorkflowError} from './errors.js';
import {TELECOM_CATALOG_ID} from '../src/a2ui/constants.js';

export type WorkflowInput = {kind: 'chat'; message: string; expectedVersion: number}
  | {kind: 'action'; action: TelecomAction};
const State = Annotation.Root({
  session: Annotation<TaskSession>(), input: Annotation<WorkflowInput>(),
  agent: Annotation<CoordinatorResult | undefined>(), result: Annotation<PlanResult>(),
  approved: Annotation<boolean>(), trace: Annotation<string[]>({reducer: (a,b) => [...a,...b], default: () => []}),
});
const copy = <T>(value: T): T => structuredClone(value);
const exactConfirmation = (text: string) => /^确认办理[。！!]?$/.test(text.trim());

export class TelecomWorkflow {
  private readonly locks = new Map<string, Promise<void>>();
  readonly graph;
  constructor(readonly store: TelecomStore) {
    this.graph = new StateGraph(State)
      .addNode('understand', async state => {
        const session = copy(state.session);
        if (state.input.kind !== 'chat') return {trace: ['understand']};
        pushHistory(session, 'user', state.input.message);
        const agent = await runCoordinatorAgent(state.input.message, session,
          {activeTask: session.activeTask, slots: session.slots, history: session.history});
        return {session, agent, trace: ['understand']};
      })
      .addNode('plan_ui', async state => {
        const session = copy(state.session);
        const result = state.input.kind === 'chat'
          ? planTurn(session, state.agent!.classification)
          : await routeAction(session, state.input.action);
        return {session, result, trace: ['plan_ui']};
      })
      .addNode('prepare_order', state => {
        const session = copy(state.session);
        const order = findOrder(String(session.slots.recommendedPackageId ?? ''));
        if (!order || !session.surfaceId || !session.workflowId) throw new WorkflowError(409, '订单信息不完整。');
        this.store.prepare(session, {id: randomUUID(), order, workflowId: session.workflowId, surfaceId: session.surfaceId});
        return {session, result: {...state.result, messages: orderSurface(session.surfaceId, order, false)}, trace: ['prepare_order']};
      })
      .addNode('await_confirmation', state => {
        const pending = state.session.pendingOrder!;
        const choice = interrupt({kind: 'confirm_order', orderId: pending.id, order: pending.order}) as {approved: boolean; orderId: string};
        if (choice.orderId !== pending.id || typeof choice.approved !== 'boolean') throw new WorkflowError(409, '确认内容不匹配。');
        return {approved: choice.approved, trace: ['await_confirmation']};
      })
      .addNode('execute_order', async state => {
        const session = copy(state.session);
        try {
          const receipt = this.store.execute(session, session.pendingOrder!.id);
          return {session, result: this.receiptResult(session, receipt), trace: ['execute_order']};
        } catch (error) {
          if (!(error instanceof WorkflowError) || error.status !== 409) throw error;
          const current = this.store.getSession(session.id);
          if (current.version !== session.version) throw error;
          session.balanceCents = current.balanceCents;
          const packageId = session.pendingOrder!.order.packageId;
          this.store.cancel(session);
          const order = findOrder(packageId);
          const result = order && session.balanceCents < Math.round(order.price * 100)
            ? await routeAction(session, {name:'purchase_traffic_package', surfaceId:session.surfaceId!, context:{packageId}})
            : planTurn(session, {intent:'traffic_purchase', parameters:{}, classifier:'mock'}, session.surfaceId);
          result.plannerDecision = {...result.plannerDecision, executionBlocked:true, reason:error.message};
          return {session, result, trace:['execute_order_blocked']};
        }
      })
      .addNode('cancel_order', state => {
        const session = copy(state.session);
        this.store.cancel(session);
        const result = planTurn(session, {intent: 'account_query', parameters: {}, classifier: 'mock'}, session.surfaceId);
        return {session, result, trace: ['cancel_order']};
      })
      .addNode('present', state => ({trace: ['present']}))
      .addEdge(START, 'understand').addEdge('understand', 'plan_ui')
      .addConditionalEdges('plan_ui', state => state.session.taskState === 'confirm_order' ? 'prepare_order' : 'present')
      .addEdge('prepare_order', 'await_confirmation')
      .addConditionalEdges('await_confirmation', state => state.approved ? 'execute_order' : 'cancel_order')
      .addEdge('execute_order', 'present').addEdge('cancel_order', 'present').addEdge('present', END)
      .compile({checkpointer: new NodeSqliteSaver(store.db)});
  }
  private receiptResult(session: TaskSession, receipt: Receipt): PlanResult {
    return {skill: 'executeOrder', taskState: 'completed', selectedCard: 'ResultCard', catalog: 'business',
      surfaceId: session.surfaceId!, uiStrategy: 'replace_component', plannerDecision: {orderId: receipt.orderId, idempotent: true},
      messages: resultSurface(session.surfaceId!, '模拟办理成功', receipt.summary, false)};
  }
  private seal(session: TaskSession, result: PlanResult, agent?: CoordinatorResult, trace: string[] = []) {
    const versioned = copy(result.messages);
    const decorate = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const obj = value as Record<string, unknown>;
      if (obj.event && typeof obj.event === 'object') {
        const event = obj.event as Record<string, unknown>;
        event.context = {...(event.context as Record<string, unknown> ?? {}), sessionVersion: session.version,
          ...(session.pendingOrder ? {pendingOrderId: session.pendingOrder.id} : {})};
      }
      for (const child of Object.values(obj)) decorate(child);
    };
    versioned.forEach(decorate);
    // 账户余额来自会话账本；界面恢复保留完整 Surface。 / Account balance comes from the session ledger; restore a complete surface.
    const previous = session.restoreMessages as Array<Record<string, any>>;
    const combined = [...previous, ...versioned] as Array<Record<string, any>>;
    const creates = combined.filter(m => m.createSurface?.surfaceId === result.surfaceId);
    const components = combined.filter(m => m.updateComponents?.surfaceId === result.surfaceId);
    const dataMessages = combined.filter(m => m.updateDataModel?.surfaceId === result.surfaceId);
    let model: Record<string, unknown> = {};
    for (const m of dataMessages) {
      const d = m.updateDataModel;
      if (d.path === '/') model = copy(d.value);
      else if (d.path === '/filters/range') model = {...model, filters: {range: d.value}};
    }
    if ((result.selectedCard === 'AccountOverviewCard' || result.selectedCard === 'TrafficDetailCard') && model.payload) {
      model.payload = {...model.payload as Record<string, unknown>, balance: session.balanceCents / 100};
      const existing = versioned.find((m: any) => m.updateDataModel?.path === '/') as any;
      if (existing) existing.updateDataModel.value = model;
    }
    const create = creates.at(-1) ?? {version: 'v0.9.1', createSurface: {surfaceId: result.surfaceId,
      catalogId: result.catalog === 'basic' ? 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json' : TELECOM_CATALOG_ID}};
    session.restoreMessages = [create, ...(components.at(-1) ? [components.at(-1)!] : []),
      ...(dataMessages.length ? [{version: 'v0.9.1', updateDataModel: {surfaceId: result.surfaceId, path: '/', value: model}}] : [])];
    session.lastDebug = {...(agent?.classification ?? {intent: session.activeTask ?? 'account_query', parameters: {}, classifier: 'mock'}),
      mergedSlots: session.slots, context: sessionSnapshot(session), agentName: agent?.agentName ?? 'TelecomWorkflow',
      agentMode: agent?.agentMode ?? 'langgraph_workflow', agentTrace: agent?.trace ?? [], agentDecision: agent?.decision ?? {},
      plannerDecision: result.plannerDecision, uiStrategy: result.uiStrategy, catalog: result.catalog,
      skill: result.skill, taskState: session.taskState, selectedCard: result.selectedCard, surfaceId: result.surfaceId,
      sessionVersion: session.version, workflow: {engine: 'langgraph', nodes: trace, waiting: session.taskState === 'confirm_order'}};
    pushHistory(session, 'assistant', `${session.taskState} -> ${result.selectedCard}`);
    this.store.save(session);
    return [{demoDebug: session.lastDebug}, ...versioned];
  }
  async restore(id: string) {
    return this.exclusive(id, async () => {
      let session = this.store.getSession(id);
      // 如果进程在扣费提交后退出，用已保存的回执重建结果。 / Rebuild the result if the process stopped after the ledger commit.
      const receipt = session.pendingOrder ? this.store.receipt(id, session.pendingOrder.id) : undefined;
      if (receipt && session.lastDebug?.taskState !== 'completed') this.seal(session, this.receiptResult(session, receipt));
      if (session.workflowId && session.taskState === 'confirm_order') {
        const config = {configurable:{thread_id:session.workflowId}, recursionLimit:24, durability:'sync' as const};
        const snapshot = await this.graph.getState(config);
        if (snapshot.next.length && !snapshot.next.includes('await_confirmation')) {
          const outcome = await this.graph.invoke(null, config);
          this.seal(outcome.session, outcome.result, outcome.agent, outcome.trace);
          session = this.store.getSession(id);
        }
      }
      if (session.workflowId && session.taskState === 'confirm_order' &&
          (session.lastDebug?.taskState !== 'confirm_order' ||
           (session.lastDebug?.context as Record<string, unknown> | undefined)?.pendingOrderId !== session.pendingOrder?.id)) {
        const pending = session.pendingOrder!;
        this.seal(session, {skill: 'validateBalance', taskState: 'confirm_order', selectedCard: 'OrderConfirmCard',
          uiStrategy: 'create_surface', catalog: 'business', surfaceId: pending.surfaceId,
          plannerDecision: {restored: true}, messages: orderSurface(pending.surfaceId, pending.order, true)});
      }
      session = this.store.getSession(id);
      const refresh = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        const obj = value as Record<string, unknown>;
        if (obj.event && typeof obj.event === 'object') {
          const event = obj.event as Record<string, unknown>;
          event.context = {...(event.context as Record<string,unknown> ?? {}),sessionVersion:session.version};
        }
        Object.values(obj).forEach(refresh);
      };
      session.restoreMessages.forEach(refresh);
      if (session.lastDebug) {session.lastDebug.sessionVersion=session.version;session.lastDebug.context=sessionSnapshot(session);}
      this.store.save(session);
      return {version: session.version, history: session.history, messages: [...(session.lastDebug ? [{demoDebug: session.lastDebug}] : []), ...session.restoreMessages]};
    });
  }
  async run(id: string, input: WorkflowInput) {
    return this.exclusive(id, async () => {
      const session = this.store.getSession(id);
      const action = input.kind === 'action' ? input.action : undefined;
      if (action && !['view_traffic','view_bill','buy_traffic','show_affordable_packages','purchase_traffic_package',
          'confirm_order','cancel_order','back_account'].includes(action.name)) throw new WorkflowError(400, '未知的界面操作。');
      if (action && (action.surfaceId !== session.surfaceId || !Number.isInteger(action.context?.sessionVersion))) {
        throw new WorkflowError(409, '界面已失效，请恢复最新会话。');
      }
      const expected = input.kind === 'chat' ? input.expectedVersion : Number(action!.context?.sessionVersion);
      const confirming = input.kind === 'chat' ? exactConfirmation(input.message) : action!.name === 'confirm_order';
      const cancelling = input.kind === 'chat' ? /^(取消|取消办理)[。！!]?$/.test(input.message.trim()) : ['cancel_order','back_account'].includes(action!.name);
      if (confirming && session.pendingOrder && session.taskState === 'completed') {
        if (action && (action.context?.pendingOrderId !== session.pendingOrder.id || action.context?.packageId !== session.pendingOrder.order.packageId)) {
          throw new WorkflowError(409, '旧订单卡片已失效。');
        }
        const receipt = this.store.receipt(id, session.pendingOrder.id);
        if (receipt) return [{demoDebug: session.lastDebug}, ...session.restoreMessages];
      }
      if (expected !== session.version) throw new WorkflowError(409, '会话已变化，请恢复最新界面后重试。');
      if (session.taskState === 'confirm_order' && session.pendingOrder) {
        if (!confirming && !cancelling) {
          if (input.kind === 'chat') return [{demoDebug: session.lastDebug}, ...session.restoreMessages];
          throw new WorkflowError(409, '请先确认或取消当前订单。');
        }
        if (action && (action.context?.pendingOrderId !== session.pendingOrder.id || (confirming && action.context?.packageId !== session.pendingOrder.order.packageId))) {
          throw new WorkflowError(409, '确认卡片与待办订单不匹配。');
        }
        this.store.begin(session, expected);
        const config = {configurable: {thread_id: session.workflowId!}, recursionLimit: 24, durability: 'sync' as const};
        const snapshot = await this.graph.getState(config);
        if (!snapshot.next.length) throw new WorkflowError(409, '工作流尚未准备好，请恢复会话后重试。');
        const outcome = await this.graph.invoke(new Command({resume: {approved: confirming, orderId: session.pendingOrder.id},
          update: {session}}), config);
        return this.seal(outcome.session, outcome.result, outcome.agent, outcome.trace);
      }
      if (confirming || (action?.name === 'cancel_order')) throw new WorkflowError(409, '当前没有待确认订单。');
      this.store.cancel(session);
      session.workflowId = `${id}:${randomUUID()}`;
      this.store.begin(session, expected);
      const outcome = await this.graph.invoke({session, input, agent: undefined, approved: false, trace: []},
        {configurable: {thread_id: session.workflowId}, recursionLimit: 24, durability: 'sync' as const});
      return this.seal(outcome.session, outcome.result, outcome.agent, outcome.trace);
    });
  }
  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => {release = resolve;});
    this.locks.set(id, next);
    await previous;
    try {return await work();}
    finally {release(); if (this.locks.get(id) === next) this.locks.delete(id);}
  }
}
