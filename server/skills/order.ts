import {trafficPackages} from '../mock-data.js';
import type {SkillDefinition} from './types.js';
export const validateBalanceSkill: SkillDefinition = {
  name:'validateBalance', description:'只读校验会话的模拟余额，不执行办理。', sideEffect:false,
  async execute(args, session) {
    const item = trafficPackages.find(p => p.id === args.packageId);
    if (!item) throw new Error('Unknown package');
    const balance = session.balanceCents / 100;
    const sufficient = balance >= item.price;
    return {data:{balance,price:item.price,sufficient,missingAmount: Math.max(0,item.price-balance)},
      summary:sufficient ? `余额 ¥${balance.toFixed(1)}，足够支付 ¥${item.price}。` : `余额不足，当前 ¥${balance.toFixed(1)}，需要 ¥${item.price}。`};
  },
};
export const executeOrderSkill: SkillDefinition = {
  name:'executeOrder',description:'模拟办理只允许由持久化工作流在明确确认后执行。',sideEffect:true,
  async execute() {throw new Error('Order execution requires the durable workflow confirmation gate');},
};
