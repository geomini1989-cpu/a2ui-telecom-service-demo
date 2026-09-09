import type {Classification} from './classifier.js';
import type {TaskSession} from './session-store.js';
import {trafficPackages} from './mock-data.js';
import {
  accountSurface,
  analyticsSurface,
  billSurface,
  findOrder,
  findOrderByParams,
  orderSurface,
  packagesSurface,
  resultSurface,
  trafficDetailSurface,
} from './a2ui-builder.js';
import {insufficientBalanceSurface} from './basic-builder.js';

export interface PlanResult {
  skill: string;
  taskState: string;
  selectedCard: string;
  uiStrategy: 'create_surface' | 'replace_component' | 'update_data_model' | 'dynamic_basic_catalog';
  catalog: 'business' | 'basic';
  surfaceId: string;
  messages: unknown[];
  plannerDecision: Record<string, unknown>;
}

function newSurface(prefix = 'assistant') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function hasTrafficSlots(slots: Record<string, unknown>) {
  return Boolean(slots.sizeGb && slots.duration && slots.type);
}

function selectTrafficPackage(slots: Record<string, unknown>) {
  if (typeof slots.recommendedPackageId === 'string') {
    const recommended = trafficPackages.find(p => p.id === slots.recommendedPackageId);
    if (recommended) return findOrder(recommended.id);
  }

  const maxPrice = typeof slots.maxPrice === 'number' ? slots.maxPrice : undefined;
  let candidates = trafficPackages.filter(p =>
    (slots.sizeGb ? p.sizeGb === slots.sizeGb : true) &&
    (slots.duration ? p.duration === slots.duration : true) &&
    (slots.type ? p.type === slots.type : true) &&
    (maxPrice !== undefined ? p.price <= maxPrice : true)
  );
  if (!candidates.length) return null;

  if (slots.preference === 'cheapest' || maxPrice !== undefined) {
    candidates = [...candidates].sort((a, b) => a.price - b.price || b.sizeGb - a.sizeGb);
    return findOrder(candidates[0].id);
  }

  if (hasTrafficSlots(slots)) return findOrderByParams(slots);
  return null;
}

export function planTurn(
  session: TaskSession,
  classification: Classification,
  requestedSurfaceId?: string,
): PlanResult {
  const previousIntent = session.activeTask;
  const previousCatalog = session.catalog;
  const sameTask = previousIntent === classification.intent;
  const requestedCanReuseBusinessSurface = Boolean(requestedSurfaceId && previousCatalog === 'business');
  if (!sameTask) {
    session.slots = {};
    session.uiSelection = {};
    session.surfaceId = undefined;
    session.catalog = undefined;
  }

  session.activeTask = classification.intent;
  session.slots = {...session.slots, ...classification.parameters};

  const reuseBusinessSurface = Boolean(
    requestedCanReuseBusinessSurface ||
    (sameTask && session.surfaceId && session.catalog === 'business')
  );
  const surfaceId = requestedSurfaceId ?? (reuseBusinessSurface ? session.surfaceId! : newSurface());

  let result: PlanResult;

  switch (classification.intent) {
    case 'traffic_query':
      result = {
        skill: 'getTrafficUsage',
        taskState: 'view_traffic',
        selectedCard: 'TrafficDetailCard',
        uiStrategy: reuseBusinessSurface ? 'replace_component' : 'create_surface',
        catalog: 'business',
        surfaceId,
        messages: trafficDetailSurface(surfaceId, !reuseBusinessSurface),
        plannerDecision: {reason: 'traffic_query', reusedSurface: reuseBusinessSurface},
      };
      break;

    case 'traffic_purchase': {
      const order = selectTrafficPackage(session.slots);
      if (order && session.slots.balanceSufficient === false) {
        const basicSurfaceId = newSurface('recovery');
        result = {
          skill: 'validateBalance',
          taskState: 'insufficient_balance',
          selectedCard: 'BasicCatalogRecoveryUI',
          uiStrategy: 'dynamic_basic_catalog',
          catalog: 'basic',
          surfaceId: basicSurfaceId,
          messages: insufficientBalanceSurface(basicSurfaceId, {
            balance: typeof session.slots.balanceAmount === 'number' ? session.slots.balanceAmount : 0,
            price: order.price,
            packageTitle: order.title,
          }),
          plannerDecision: {
            reason: 'balance_insufficient',
            parametersComplete: hasTrafficSlots(session.slots),
            selectedPackage: order.packageId,
            balance: 'validated_by_skill',
            required: order.price,
          },
        };
      } else if (order) {
        const selection = {
          type: String(session.slots.type ?? (order.type === '通用流量' ? 'general' : 'directed')),
          duration: String(session.slots.duration ?? (order.duration === '30天' ? '30d' : '7d')),
          packageId: order.packageId,
          recommendationText: typeof session.slots.recommendationReason === 'string' ? session.slots.recommendationReason : undefined,
        };
        result = {
          skill: 'getTrafficPackages',
          taskState: 'select_package',
          selectedCard: 'TrafficPackageCard',
          uiStrategy: reuseBusinessSurface ? 'replace_component' : 'create_surface',
          catalog: 'business',
          surfaceId,
          messages: packagesSurface(surfaceId, !reuseBusinessSurface, selection),
          plannerDecision: {
            reason: hasTrafficSlots(session.slots) ? 'parameters_complete_requires_user_confirmation' : 'constraint_resolved_requires_user_confirmation',
            parametersComplete: hasTrafficSlots(session.slots),
            selectedPackage: order.packageId,
            skippedPackageSelection: false,
            requiresExplicitConfirmation: true,
          },
        };
      } else {
        const selection = {
          type: String(session.slots.type ?? 'general'),
          duration: String(session.slots.duration ?? '30d'),
          packageId: '',
        };
        result = {
          skill: 'getTrafficPackages',
          taskState: 'select_package',
          selectedCard: 'TrafficPackageCard',
          uiStrategy: reuseBusinessSurface ? 'replace_component' : 'create_surface',
          catalog: 'business',
          surfaceId,
          messages: packagesSurface(surfaceId, !reuseBusinessSurface, selection),
          plannerDecision: {
            reason: 'missing_or_ambiguous_parameters',
            parametersComplete: hasTrafficSlots(session.slots),
            knownSlots: session.slots,
          },
        };
      }
      break;
    }

    case 'bill_query':
      result = {
        skill: 'getBill',
        taskState: 'view_bill',
        selectedCard: 'BillCard',
        uiStrategy: reuseBusinessSurface ? 'replace_component' : 'create_surface',
        catalog: 'business',
        surfaceId,
        messages: billSurface(surfaceId, !reuseBusinessSurface),
        plannerDecision: {reason: 'bill_query'},
      };
      break;

    case 'business_analysis': {
      const range = String(session.slots.range ?? (session.slots.month ? '6m' : '30d'));
      const pureRangeUpdate = reuseBusinessSurface && session.selectedCard === 'AnalyticsCard';
      result = {
        skill: 'getBusinessMetrics',
        taskState: 'view_analytics',
        selectedCard: 'AnalyticsCard',
        uiStrategy: pureRangeUpdate ? 'update_data_model' : (reuseBusinessSurface ? 'replace_component' : 'create_surface'),
        catalog: 'business',
        surfaceId,
        messages: analyticsSurface(surfaceId, range, !reuseBusinessSurface, pureRangeUpdate),
        plannerDecision: {
          reason: pureRangeUpdate ? 'same_surface_filter_update' : 'analytics_query',
          range,
          metric: session.slots.metric ?? 'all',
        },
      };
      break;
    }

    case 'customer_service':
      result = {
        skill: 'openCustomerService',
        taskState: 'completed',
        selectedCard: 'ResultCard',
        uiStrategy: reuseBusinessSurface ? 'replace_component' : 'create_surface',
        catalog: 'business',
        surfaceId,
        messages: resultSurface(surfaceId, '已为你连接智能客服', '当前为演示环境：真实系统可在这里进入人工/智能客服协同流程。', !reuseBusinessSurface),
        plannerDecision: {reason: 'customer_service'},
      };
      break;

    default:
      result = {
        skill: 'getAccountInfo',
        taskState: 'account_overview',
        selectedCard: 'AccountOverviewCard',
        uiStrategy: reuseBusinessSurface ? 'replace_component' : 'create_surface',
        catalog: 'business',
        surfaceId,
        messages: accountSurface(surfaceId, !reuseBusinessSurface),
        plannerDecision: {reason: 'account_query'},
      };
  }

  session.taskState = result.taskState;
  session.surfaceId = result.surfaceId;
  session.catalog = result.catalog;
  session.selectedCard = result.selectedCard;
  return result;
}
