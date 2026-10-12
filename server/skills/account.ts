import {account} from '../mock-data.js';
import type {SkillDefinition} from './types.js';

export const getAccountInfoSkill: SkillDefinition = {
  name: 'getAccountInfo',
  description: '读取当前用户的套餐、余额、流量、语音和短信账户信息。',
  sideEffect: false,
  async execute(_args, session) {
    return {
      data: {...account, balance: session.balanceCents / 100},
      summary: `账户余额 ¥${(session.balanceCents / 100).toFixed(1)}，当前套餐 ${account.planName}。`,
    };
  },
};
