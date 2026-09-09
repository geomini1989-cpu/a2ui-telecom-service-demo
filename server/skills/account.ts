import {account} from '../mock-data.js';
import type {SkillDefinition} from './types.js';

export const getAccountInfoSkill: SkillDefinition = {
  name: 'getAccountInfo',
  description: '读取当前用户的套餐、余额、流量、语音和短信账户信息。',
  sideEffect: false,
  async execute() {
    return {
      data: account,
      summary: `账户余额 ¥${account.balance.toFixed(1)}，当前套餐 ${account.planName}。`,
    };
  },
};
