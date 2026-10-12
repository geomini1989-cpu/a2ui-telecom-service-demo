import type {TaskSession} from './session-store.js';
import {planTurn, type PlanResult} from './planner.js';
import {accountSurface, findOrder, orderSurface} from './a2ui-builder.js';
import {insufficientBalanceSurface} from './basic-builder.js';
import {runSkill} from './skills/registry.js';
import {WorkflowError} from './errors.js';
export interface TelecomAction {name: string; surfaceId: string; context?: Record<string, unknown>}
export async function routeAction(session: TaskSession, a: TelecomAction): Promise<PlanResult> {
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
        const maxPrice = session.balanceCents / 100;
        const preservedType = session.slots.type;
        const preservedDuration = session.slots.duration;
        session.slots = {
          ...(preservedType ? {type: preservedType} : {}),
          ...(preservedDuration ? {duration: preservedDuration} : {}),
        };
        session.surfaceId = undefined;
        session.catalog = undefined;
        session.selectedCard = undefined;
        session.taskState = 'select_package';

        const planned = planTurn(session, {
          intent: 'traffic_purchase',
          parameters: {
            maxPrice,
            recommendationReason: `已按当前余额 ¥${maxPrice.toFixed(1)} 筛选可支付套餐，可重新选择。`,
          },
          classifier: 'mock',
        });
        ({skill, taskState, selectedCard, uiStrategy, catalog, surfaceId, plannerDecision, messages} = planned);
        plannerDecision = {
          ...plannerDecision,
          reason: 'recover_from_insufficient_balance',
          maxPrice,
          clearedPreviousRecommendation: true,
        };
        break;
      }

      case 'purchase_traffic_package': {
        const packageId = String(a.context?.packageId || '');
        const order = findOrder(packageId);
        if (!order) throw new WorkflowError(400, '未知套餐。');
        if (typeof session.slots.maxPrice === 'number' && order.price > session.slots.maxPrice) {
          throw new WorkflowError(409, '所选套餐超过当前预算，请重新选择。');
        }

        const validation = await runSkill('validateBalance', {packageId}, session, false);
        const balance = validation.output as {sufficient?: boolean; balance?: number; price?: number};
        const balanceAmount = typeof balance.balance === 'number' ? balance.balance : 0;
        const sufficient = balance.sufficient === true;

        session.activeTask = 'traffic_purchase';
        session.slots = {
          ...session.slots,
          sizeGb: order.sizeGb,
          duration: order.duration === '30天' ? '30d' : '7d',
          type: order.type === '通用流量' ? 'general' : 'directed',
          recommendedPackageId: packageId,
          balanceSufficient: sufficient,
          balanceAmount,
        };

        if (!sufficient) {
          const recoverySurfaceId = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          session.taskState = 'insufficient_balance';
          session.surfaceId = recoverySurfaceId;
          session.catalog = 'basic';
          session.selectedCard = 'BasicCatalogRecoveryUI';

          skill = 'validateBalance';
          taskState = 'insufficient_balance';
          selectedCard = 'BasicCatalogRecoveryUI';
          uiStrategy = 'dynamic_basic_catalog';
          catalog = 'basic';
          surfaceId = recoverySurfaceId;
          plannerDecision = {
            reason: 'selected_package_balance_insufficient',
            selectedPackage: packageId,
            balance: balanceAmount,
            required: order.price,
            recoveryAction: 'show_affordable_packages',
            skillObservation: validation.summary,
          };
          messages = insufficientBalanceSurface(recoverySurfaceId, {
            balance: balanceAmount,
            price: order.price,
            packageTitle: order.title,
          });
          break;
        }

        session.taskState = 'confirm_order';
        session.surfaceId = a.surfaceId;
        session.catalog = 'business';
        session.selectedCard = 'OrderConfirmCard';

        skill = 'validateBalance';
        taskState = 'confirm_order';
        selectedCard = 'OrderConfirmCard';
        uiStrategy = 'replace_component';
        catalog = 'business';
        surfaceId = a.surfaceId;
        plannerDecision = {
          reason: 'package_selected_balance_validated',
          selectedPackage: packageId,
          balance: balanceAmount,
          required: order.price,
          requiresExplicitConfirmation: true,
          skillObservation: validation.summary,
        };
        messages = orderSurface(a.surfaceId, order, false);
        break;
      }

      case 'confirm_order': throw new WorkflowError(409, '没有等待确认的订单。');

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

      default: throw new WorkflowError(400, '未知的界面操作。');
    }

    return {skill, taskState, selectedCard, uiStrategy: uiStrategy as PlanResult['uiStrategy'], catalog, surfaceId, plannerDecision, messages};
}
