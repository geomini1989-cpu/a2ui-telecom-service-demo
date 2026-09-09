import {account, trafficPackages} from '../mock-data.js';
import type {SkillDefinition} from './types.js';

export const validateBalanceSkill: SkillDefinition = {
  name: 'validateBalance',
  description: '校验当前余额是否足够支付指定套餐；只读，不执行办理。',
  sideEffect: false,
  async execute(args) {
    const packageId = String(args.packageId ?? '');
    const item = trafficPackages.find(p => p.id === packageId);
    const price = item?.price ?? Number(args.price ?? 0);
    const sufficient = account.balance >= price;
    return {
      data: {
        balance: account.balance,
        price,
        sufficient,
        missingAmount: Number(Math.max(0, price - account.balance).toFixed(1)),
      },
      summary: sufficient
        ? `余额 ¥${account.balance.toFixed(1)}，足够支付 ¥${price}。`
        : `余额不足，当前 ¥${account.balance.toFixed(1)}，需要 ¥${price}。`,
    };
  },
};

export const executeOrderSkill: SkillDefinition = {
  name: 'executeOrder',
  description: '执行流量包办理。该 Skill 有副作用，只允许在用户明确确认后由服务端调用，不能由 Agent 自主调用。',
  sideEffect: true,
  async execute(args) {
    const packageId = String(args.packageId ?? '');
    const item = trafficPackages.find(p => p.id === packageId);
    if (!item) throw new Error('Unknown package');

    return {
      data: {
        success: true,
        orderId: `DEMO-${Date.now()}`,
        packageId: item.id,
        title: item.title,
      },
      summary: `${item.title} 已办理成功。`,
    };
  },
};
