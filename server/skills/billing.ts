import {bill} from '../mock-data.js';
import type {SkillDefinition} from './types.js';

export const getBillSkill: SkillDefinition = {
  name: 'getBill',
  description: '读取当前账期的账单金额和费用明细。',
  sideEffect: false,
  async execute() {
    return {
      data: bill,
      summary: `${bill.month}账单合计 ¥${bill.total.toFixed(2)}。`,
    };
  },
};
