import type {AccountData, AnalyticsData, TrafficPackage} from '../src/types.js';

export const account: AccountData = {
  phone: '130****8888',
  planName: '5G畅享融合套餐',
  balance: 56.8,
  traffic: {used: 12.5, total: 30, directedUsed: 8.2, directedTotal: 15},
  voice: {used: 280, total: 500},
  sms: {used: 45, total: 100},
};

export const trafficPackages: TrafficPackage[] = [
  {id:'g7-10', type:'general', duration:'7d', sizeGb:10, price:8, title:'10GB通用流量·7天'},
  {id:'g7-20', type:'general', duration:'7d', sizeGb:20, price:14, title:'20GB通用流量·7天'},
  {id:'g30-10', type:'general', duration:'30d', sizeGb:10, price:10, title:'10GB通用流量·30天'},
  {id:'g30-20', type:'general', duration:'30d', sizeGb:20, price:18, title:'20GB通用流量·30天'},
  {id:'g30-30', type:'general', duration:'30d', sizeGb:30, price:25, title:'30GB通用流量·30天'},
  {id:'g30-100', type:'general', duration:'30d', sizeGb:100, price:88, title:'100GB通用流量·30天'},
  {id:'d7-10', type:'directed', duration:'7d', sizeGb:10, price:5, title:'10GB视频定向·7天'},
  {id:'d30-20', type:'directed', duration:'30d', sizeGb:20, price:12, title:'20GB视频定向·30天'},
];

export const bill = {month:'2026年8月', total:68.8, items:[{label:'套餐月费',value:49},{label:'流量增值包',value:10},{label:'语音超套',value:6.8},{label:'其他',value:3}]};

const revenue = [{name:'流量收入',value:38.7},{name:'语音收入',value:18.3},{name:'短信彩信',value:6.5},{name:'增值业务',value:25.8},{name:'其他',value:10.7}];
export const analytics: AnalyticsData = {ranges:{
  '7d':{labels:['周一','周二','周三','周四','周五','周六','周日'],activeUsers:[7800,8100,8400,8200,9000,9600,10100],packageSales:[520,610,580,720,690,810,880],revenue},
  '30d':{labels:['1周','2周','3周','4周'],activeUsers:[8900,10500,11200,12800],packageSales:[1820,2680,3460,4210],revenue},
  '6m':{labels:['3月','4月','5月','6月','7月','8月'],activeUsers:[5200,4800,7100,7600,10500,12800],packageSales:[3940,2680,5820,3460,4210,5100],revenue},
}};
