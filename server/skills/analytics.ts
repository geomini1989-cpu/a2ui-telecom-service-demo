import {analytics} from '../mock-data.js';
import type {SkillDefinition} from './types.js';

export const getBusinessMetricsSkill: SkillDefinition = {
  name: 'getBusinessMetrics',
  description: '读取业务活跃、套餐销量和收入构成等分析数据。',
  sideEffect: false,
  async execute(args) {
    const range = typeof args.range === 'string' && analytics.ranges[args.range] ? args.range : '30d';
    return {
      data: analytics,
      summary: `已读取 ${range} 范围的业务分析数据。`,
    };
  },
};
