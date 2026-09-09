import {account, trafficPackages} from '../mock-data.js';
import type {TrafficPackage} from '../../src/types.js';
import type {SkillDefinition} from './types.js';

export const getTrafficUsageSkill: SkillDefinition = {
  name: 'getTrafficUsage',
  description: '读取当前流量使用情况，并给出近期使用速度和剩余周期的需求估算。',
  sideEffect: false,
  async execute() {
    const remainingGb = Math.max(0, account.traffic.total - account.traffic.used);
    const daysRemaining = 12;
    const recentDailyAverageGb = 1.8;
    const projectedNeedGb = Number((recentDailyAverageGb * daysRemaining).toFixed(1));
    const projectedExtraGb = Number(Math.max(0, projectedNeedGb - remainingGb).toFixed(1));

    return {
      data: {
        account,
        remainingGb,
        daysRemaining,
        recentDailyAverageGb,
        projectedNeedGb,
        projectedExtraGb,
      },
      summary: `通用流量剩余 ${remainingGb.toFixed(1)}GB，距周期结束约 ${daysRemaining} 天；按近期每天约 ${recentDailyAverageGb}GB 估算，后续约需要 ${projectedNeedGb}GB。`,
    };
  },
};

export const getTrafficPackagesSkill: SkillDefinition = {
  name: 'getTrafficPackages',
  description: '按容量、有效期、类型和预算筛选可办理流量包。',
  sideEffect: false,
  async execute(args) {
    const maxPrice = typeof args.maxPrice === 'number' ? args.maxPrice : undefined;
    const sizeGb = typeof args.sizeGb === 'number' ? args.sizeGb : undefined;
    const duration = args.duration === '7d' || args.duration === '30d' ? args.duration : undefined;
    const type = args.type === 'general' || args.type === 'directed' ? args.type : undefined;

    const packages: TrafficPackage[] = trafficPackages.filter(item =>
      (sizeGb !== undefined ? item.sizeGb === sizeGb : true) &&
      (duration ? item.duration === duration : true) &&
      (type ? item.type === type : true) &&
      (maxPrice !== undefined ? item.price <= maxPrice : true)
    );

    return {
      data: packages,
      summary: `找到 ${packages.length} 个符合当前条件的流量包。`,
    };
  },
};
