import type {TaskSession} from '../session-store.js';
import {getAccountInfoSkill} from './account.js';
import {getTrafficUsageSkill, getTrafficPackagesSkill} from './traffic.js';
import {getBillSkill} from './billing.js';
import {getBusinessMetricsSkill} from './analytics.js';
import {executeOrderSkill, validateBalanceSkill} from './order.js';
import type {SkillDefinition, SkillName, SkillObservation} from './types.js';

const registry: Record<SkillName, SkillDefinition> = {
  getAccountInfo: getAccountInfoSkill,
  getTrafficUsage: getTrafficUsageSkill,
  getTrafficPackages: getTrafficPackagesSkill,
  getBill: getBillSkill,
  getBusinessMetrics: getBusinessMetricsSkill,
  validateBalance: validateBalanceSkill,
  executeOrder: executeOrderSkill,
};

export const AGENT_READONLY_SKILLS: SkillName[] = [
  'getAccountInfo',
  'getTrafficUsage',
  'getTrafficPackages',
  'getBill',
  'getBusinessMetrics',
  'validateBalance',
];

export function getSkillDefinition(name: SkillName) {
  return registry[name];
}

export async function runSkill(
  name: SkillName,
  args: Record<string, unknown>,
  session: TaskSession,
  allowSideEffect = false,
): Promise<SkillObservation> {
  const skill = registry[name];
  if (!skill) throw new Error(`Unknown skill: ${name}`);
  if (skill.sideEffect && !allowSideEffect) {
    throw new Error(`Skill ${name} has side effects and requires explicit authorization`);
  }

  const result = await skill.execute(args, session);
  return {
    skill: name,
    args,
    output: result.data,
    summary: result.summary,
    sideEffect: skill.sideEffect,
  };
}
