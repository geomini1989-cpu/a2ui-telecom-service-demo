import {classify, type Classification, type ClassificationContext} from '../classifier.js';
import type {TaskSession} from '../session-store.js';
import type {TrafficPackage} from '../../src/types.js';
import {runSkill} from '../skills/registry.js';
import type {SkillObservation} from '../skills/types.js';

export interface AgentTraceStep {
  step: number;
  kind: 'understand' | 'skill' | 'decision';
  label: string;
  detail: unknown;
}

export interface CoordinatorResult {
  classification: Classification;
  agentName: 'TelecomCoordinatorAgent';
  observations: SkillObservation[];
  trace: AgentTraceStep[];
  decision: Record<string, unknown>;
}

function wantsUsageAwareRecommendation(message: string) {
  return /掉得快|用得快|不够|撑到|撑一个月|最近.*流量|推荐|合适|性价比|够用/.test(message);
}

function choosePackage(
  packages: TrafficPackage[],
  slots: Record<string, unknown>,
  projectedExtraGb?: number,
) {
  if (!packages.length) return null;

  if (typeof slots.recommendedPackageId === 'string') {
    const exact = packages.find(p => p.id === slots.recommendedPackageId);
    if (exact) return exact;
  }

  if (projectedExtraGb && projectedExtraGb > 0) {
    const enough = packages
      .filter(p => p.sizeGb >= projectedExtraGb)
      .sort((a, b) => a.price - b.price || a.sizeGb - b.sizeGb);
    if (enough.length) return enough[0];

    return [...packages].sort((a, b) => b.sizeGb - a.sizeGb || a.price - b.price)[0];
  }

  if (slots.preference === 'cheapest' || typeof slots.maxPrice === 'number') {
    return [...packages].sort((a, b) => a.price - b.price || b.sizeGb - a.sizeGb)[0];
  }

  if (typeof slots.sizeGb === 'number') {
    const exact = packages.find(p => p.sizeGb === slots.sizeGb);
    if (exact) return exact;
  }

  return null;
}

export async function runCoordinatorAgent(
  message: string,
  session: TaskSession,
  context: ClassificationContext,
): Promise<CoordinatorResult> {
  const trace: AgentTraceStep[] = [];
  const observations: SkillObservation[] = [];

  const classification = await classify(message, context);
  const mergedSlots = {...session.slots, ...classification.parameters};

  trace.push({
    step: 1,
    kind: 'understand',
    label: 'Understand user goal',
    detail: {
      intent: classification.intent,
      extractedParameters: classification.parameters,
      mergedSlots,
      llmCalled: classification.llmCalled ?? false,
      llmStatus: classification.llmStatus ?? 'not_called',
    },
  });

  const observe = async (skill: Parameters<typeof runSkill>[0], args: Record<string, unknown>) => {
    const observation = await runSkill(skill, args, session);
    observations.push(observation);
    trace.push({
      step: trace.length + 1,
      kind: 'skill',
      label: skill,
      detail: {
        args,
        summary: observation.summary,
        output: observation.output,
      },
    });
    return observation;
  };

  const decision: Record<string, unknown> = {
    intent: classification.intent,
    next: 'render_ui',
  };

  switch (classification.intent) {
    case 'account_query':
      await observe('getAccountInfo', {});
      decision.reason = 'account_information_requested';
      break;

    case 'traffic_query':
      await observe('getTrafficUsage', {});
      decision.reason = 'traffic_usage_requested';
      break;

    case 'traffic_purchase': {
      let projectedExtraGb: number | undefined;

      if (wantsUsageAwareRecommendation(message)) {
        const usage = await observe('getTrafficUsage', {});
        const output = usage.output as {projectedExtraGb?: number};
        projectedExtraGb = output.projectedExtraGb;
        decision.usageAware = true;
        decision.projectedExtraGb = projectedExtraGb;
      }

      const packageObservation = await observe('getTrafficPackages', mergedSlots);
      const packages = packageObservation.output as TrafficPackage[];
      const selected = choosePackage(packages, mergedSlots, projectedExtraGb);

      if (selected) {
        const balanceObservation = await observe('validateBalance', {packageId: selected.id});
        const balance = balanceObservation.output as {sufficient?: boolean; balance?: number; price?: number};

        classification.parameters = {
          ...classification.parameters,
          recommendedPackageId: selected.id,
          recommendationReason: projectedExtraGb
            ? `按近期使用速度估算还需要约 ${projectedExtraGb}GB，推荐 ${selected.title}，在满足预计需求的候选中价格更合适。`
            : (mergedSlots.preference === 'cheapest'
              ? `按“最便宜”条件推荐 ${selected.title}。`
              : `已根据当前条件定位到 ${selected.title}。`),
          balanceSufficient: Boolean(balance.sufficient),
        };

        decision.recommendedPackageId = selected.id;
        decision.recommendationReason = classification.parameters.recommendationReason;
        decision.balanceSufficient = Boolean(balance.sufficient);
      } else {
        decision.reason = packages.length
          ? 'need_user_selection'
          : 'no_matching_package';
      }
      break;
    }

    case 'bill_query':
      await observe('getBill', mergedSlots);
      decision.reason = 'bill_requested';
      break;

    case 'business_analysis':
      await observe('getBusinessMetrics', mergedSlots);
      decision.reason = 'business_metrics_requested';
      break;

    case 'customer_service':
      decision.reason = 'handoff_to_customer_service';
      break;
  }

  trace.push({
    step: trace.length + 1,
    kind: 'decision',
    label: 'Coordinator decision',
    detail: decision,
  });

  return {
    classification,
    agentName: 'TelecomCoordinatorAgent',
    observations,
    trace,
    decision,
  };
}
