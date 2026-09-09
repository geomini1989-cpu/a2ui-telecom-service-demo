import type {TaskSession} from '../session-store.js';

export type SkillName =
  | 'getAccountInfo'
  | 'getTrafficUsage'
  | 'getTrafficPackages'
  | 'getBill'
  | 'getBusinessMetrics'
  | 'validateBalance'
  | 'executeOrder';

export interface SkillExecutionResult<T = unknown> {
  data: T;
  summary: string;
}

export interface SkillDefinition {
  name: SkillName;
  description: string;
  sideEffect: boolean;
  execute: (
    args: Record<string, unknown>,
    session: TaskSession,
  ) => Promise<SkillExecutionResult>;
}

export interface SkillObservation {
  skill: SkillName;
  args: Record<string, unknown>;
  output: unknown;
  summary: string;
  sideEffect: boolean;
}
