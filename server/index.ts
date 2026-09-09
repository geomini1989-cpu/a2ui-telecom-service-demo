import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {runCoordinatorAgent} from './agent/coordinator.js';
import {planTurn} from './planner.js';
import {getSession, pushHistory, sessionSnapshot} from './session-store.js';
import {accountSurface, findOrder, findOrderByParams, orderSurface, packagesSurface, resultSurface} from './a2ui-builder.js';
import {runSkill} from './skills/registry.js';

const app = express();
app.use(cors());
app.use(express.json());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isExplicitNaturalLanguageConfirmation = (message: string) =>
  /^确认办理[。！!]?$/.test(message.trim());

const send = async (res: express.Response, items: unknown[]) => {
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  for (const item of items) {
    res.write(JSON.stringify(item) + '\n');
    await sleep(120);
  }
  res.end();
};

app.post('/api/chat/stream', async (req, res) => {
  try {
    const message = String(req.body?.message ?? '');
    const sessionId = String(req.body?.sessionId ?? 'default');
    const session = getSession(sessionId);
    pushHistory(session, 'user', message);

    if (session.taskState === 'confirm_order' && session.surfaceId && session.catalog === 'business') {
      if (isExplicitNaturalLanguageConfirmation(message)) {
        const surfaceId = session.surfaceId;
        const pendingOrder = findOrderByParams(session.slots);
        if (!pendingOrder) throw new Error('No pending order to confirm');

        const execution = await runSkill('executeOrder', {packageId: pendingOrder.packageId}, session, true);

        session.taskState = 'completed';
        session.selectedCard = 'ResultCard';

        pushHistory(session, 'assistant', 'completed -> ResultCard');

        await send(res, [
          {
            demoDebug: {
              intent: session.activeTask ?? 'traffic_purchase',
              parameters: {explicitConfirmation: true},
              mergedSlots: session.slots,
              context: sessionSnapshot(session),
              plannerDecision: {
                reason: 'explicit_natural_language_confirmation',
                confirmationText: '确认办理',
                requiresExplicitConfirmation: true,
              },
              agentName: 'SafetyConfirmationGate',
              agentMode: 'confirmation_gate',
              agentTrace: [
                {step: 1, kind: 'decision', label: 'Explicit confirmation guard', detail: {accepted: true, text: '确认办理'}},
                {step: 2, kind: 'skill', label: 'executeOrder', detail: {summary: execution.summary, output: execution.output}},
              ],
              agentDecision: {authorizedSideEffect: true, packageId: pendingOrder.packageId},
              uiStrategy: 'replace_component',
              catalog: 'business',
              classifier: 'mock',
              llmCalled: false,
              llmStatus: 'not_called',
              skill: 'executeOrder',
              taskState: 'completed',
              selectedCard: 'ResultCard',
              surfaceId,
            },
          },
          ...resultSurface(surfaceId, '办理成功', execution.summary, false),
        ]);
        return;
      }

      const pendingOrder = findOrderByParams(session.slots);
      if (pendingOrder) {
        const surfaceId = session.surfaceId;
        pushHistory(session, 'assistant', 'confirm_order -> OrderConfirmCard');

        await send(res, [
          {
            demoDebug: {
              intent: session.activeTask ?? 'traffic_purchase',
              parameters: {},
              mergedSlots: session.slots,
              context: sessionSnapshot(session),
              plannerDecision: {
                reason: 'explicit_confirmation_required',
                rejectedAsConfirmation: message,
                acceptedNaturalLanguageConfirmation: '确认办理',
                requiresExplicitConfirmation: true,
              },
              agentName: 'SafetyConfirmationGate',
              agentMode: 'confirmation_gate',
              agentTrace: [
                {step: 1, kind: 'decision', label: 'Explicit confirmation guard', detail: {accepted: false, text: message}},
              ],
              agentDecision: {authorizedSideEffect: false, requiresExactText: '确认办理'},
              uiStrategy: 'replace_component',
              catalog: 'business',
              classifier: 'mock',
              llmCalled: false,
              llmStatus: 'not_called',
              skill: 'awaitExplicitConfirmation',
              taskState: 'confirm_order',
              selectedCard: 'OrderConfirmCard',
              surfaceId,
            },
          },
          ...orderSurface(surfaceId, pendingOrder, false),
        ]);
        return;
      }
    }

    const agent = await runCoordinatorAgent(message, session, {
      activeTask: session.activeTask,
      slots: session.slots,
      history: session.history,
    });

    const routed = planTurn(session, agent.classification);
    pushHistory(session, 'assistant', `${routed.taskState} -> ${routed.selectedCard}`);

    await send(res, [
      {
        demoDebug: {
          ...agent.classification,
          mergedSlots: session.slots,
          context: sessionSnapshot(session),
          agentName: agent.agentName,
          agentMode: agent.agentMode,
          agentTrace: agent.trace,
          agentDecision: agent.decision,
          plannerDecision: routed.plannerDecision,
          uiStrategy: routed.uiStrategy,
          catalog: routed.catalog,
          skill: routed.skill,
          taskState: routed.taskState,
          selectedCard: routed.selectedCard,
          surfaceId: routed.surfaceId,
        },
      },
      ...routed.messages,
    ]);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e));
  }
});

app.post('/api/action/stream', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? 'default');
    const session = getSession(sessionId);
    const a = req.body?.action as {name: string; surfaceId: string; context?: Record<string, unknown>};

    let skill = 'actionRouter';
    let taskState = session.taskState ?? '';
    let selectedCard = session.selectedCard ?? '';
    let uiStrategy = 'replace_component';
    let catalog: 'business' | 'basic' = 'business';
    let surfaceId = a.surfaceId;
    let plannerDecision: Record<string, unknown> = {reason: 'deterministic_action', action: a.name};
    let messages: unknown[] = [];

    switch (a.name) {
      case 'view_traffic': {
        const planned = planTurn(session, {intent: 'traffic_query', parameters: {}, classifier: 'mock'}, a.surfaceId);
        ({skill, taskState, selectedCard, uiStrategy, catalog, surfaceId, plannerDecision, messages} = planned);
        break;
      }

      case 'view_bill': {
        const planned = planTurn(session, {intent: 'bill_query', parameters: {}, classifier: 'mock'}, a.surfaceId);
        ({skill, taskState, selectedCard, uiStrategy, catalog, surfaceId, plannerDecision, messages} = planned);
        break;
      }

      case 'buy_traffic': {
        const planned = planTurn(session, {intent: 'traffic_purchase', parameters: {}, classifier: 'mock'}, a.surfaceId);
        ({skill, taskState, selectedCard, uiStrategy, catalog, surfaceId, plannerDecision, messages} = planned);
        break;
      }

      case 'show_affordable_packages': {
        const maxPrice = Number(a.context?.maxPrice ?? 0);
        session.surfaceId = undefined;
        session.catalog = undefined;
        const planned = planTurn(session, {
          intent: 'traffic_purchase',
          parameters: {maxPrice},
          classifier: 'mock',
        });
        ({skill, taskState, selectedCard, uiStrategy, catalog, surfaceId, plannerDecision, messages} = planned);
        break;
      }

      case 'purchase_traffic_package': {
        const packageId = String(a.context?.packageId || '');
        const order = findOrder(packageId);
        if (!order) throw new Error('Unknown package');

        session.activeTask = 'traffic_purchase';
        session.slots = {
          ...session.slots,
          sizeGb: order.sizeGb,
          duration: order.duration === '30天' ? '30d' : '7d',
          type: order.type === '通用流量' ? 'general' : 'directed',
        };
        session.taskState = 'confirm_order';
        session.surfaceId = a.surfaceId;
        session.catalog = 'business';
        session.selectedCard = 'OrderConfirmCard';

        skill = 'buildOrderPreview';
        taskState = 'confirm_order';
        selectedCard = 'OrderConfirmCard';
        uiStrategy = 'replace_component';
        catalog = 'business';
        surfaceId = a.surfaceId;
        plannerDecision = {reason: 'package_selected', selectedPackage: packageId};
        messages = orderSurface(a.surfaceId, order, false);
        break;
      }

      case 'confirm_order': {
        const packageId = String(a.context?.packageId || '');
        const execution = await runSkill('executeOrder', {packageId}, session, true);

        session.taskState = 'completed';
        session.selectedCard = 'ResultCard';
        session.surfaceId = a.surfaceId;
        session.catalog = 'business';
        skill = 'executeOrder';
        taskState = 'completed';
        selectedCard = 'ResultCard';
        uiStrategy = 'replace_component';
        catalog = 'business';
        plannerDecision = {
          reason: 'explicit_button_confirmation',
          authorizedSideEffect: true,
          skillObservation: execution.summary,
        };
        messages = resultSurface(a.surfaceId, '办理成功', execution.summary, false);
        break;
      }

      case 'cancel_order':
      case 'back_account': {
        const targetSurface = session.catalog === 'business' && session.surfaceId === a.surfaceId
          ? a.surfaceId
          : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const create = targetSurface !== a.surfaceId;
        session.activeTask = 'account_query';
        session.slots = {};
        session.taskState = 'account_overview';
        session.surfaceId = targetSurface;
        session.catalog = 'business';
        session.selectedCard = 'AccountOverviewCard';
        skill = 'getAccountInfo';
        taskState = 'account_overview';
        selectedCard = 'AccountOverviewCard';
        uiStrategy = create ? 'create_surface' : 'replace_component';
        catalog = 'business';
        surfaceId = targetSurface;
        plannerDecision = {reason: 'back_to_account', createdNewSurface: create};
        messages = accountSurface(targetSurface, create);
        break;
      }

      default:
        session.taskState = 'completed';
        session.selectedCard = 'ResultCard';
        session.surfaceId = a.surfaceId;
        session.catalog = 'business';
        skill = 'unknownAction';
        taskState = 'completed';
        selectedCard = 'ResultCard';
        uiStrategy = 'replace_component';
        catalog = 'business';
        messages = resultSurface(a.surfaceId, '暂不支持', '这个 Action 还没有接入演示路由。', false);
    }

    await send(res, [
      {
        demoDebug: {
          intent: session.activeTask ?? 'account_query',
          parameters: a.context ?? {},
          mergedSlots: session.slots,
          context: sessionSnapshot(session),
          plannerDecision,
          uiStrategy,
          catalog,
          classifier: 'mock',
          llmCalled: false,
          llmStatus: 'not_called',
          agentName: 'ActionRouter',
          agentMode: 'deterministic_action',
          agentTrace: [
            {step: 1, kind: 'decision', label: 'A2UI action', detail: {action: a.name, context: a.context ?? {}}},
          ],
          agentDecision: plannerDecision,
          skill,
          taskState,
          selectedCard,
          surfaceId,
        },
      },
      ...messages,
    ]);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e));
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`A2UI demo server http://localhost:${port}`));
