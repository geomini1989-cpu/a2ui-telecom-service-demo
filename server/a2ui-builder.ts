import {TELECOM_CATALOG_ID} from '../src/a2ui/constants.js';
import {account, analytics, bill, trafficPackages} from './mock-data.js';
import type {OrderData} from '../src/types.js';

export const VERSION = 'v0.9.1' as const;
const action = (name: string, context?: Record<string, unknown>) => ({event:{name,...(context?{context}:{})}});
const path = (p:string) => ({path:p});

export function accountSurface(surfaceId:string, create=true){return wrap(surfaceId,'AccountOverviewCard',{data:path('/payload'),onViewTraffic:action('view_traffic'),onViewBill:action('view_bill'),onBuyTraffic:action('buy_traffic')},{payload:account},create)}
export function trafficDetailSurface(surfaceId:string, create=true){return wrap(surfaceId,'TrafficDetailCard',{data:path('/payload'),onBuyTraffic:action('buy_traffic'),onBack:action('back_account')},{payload:account},create)}
export function packagesSurface(surfaceId:string, create=true, selection:{type?:string;duration?:string;packageId?:string;recommendationText?:string}={}){return wrap(surfaceId,'TrafficPackageCard',{packages:path('/payload/packages'),selectedType:path('/selection/type'),selectedDuration:path('/selection/duration'),selectedPackageId:path('/selection/packageId'),recommendationText:path('/selection/recommendationText'),onSubmit:action('purchase_traffic_package',{packageId:path('/selection/packageId')}),onBack:action('back_account')},{payload:{packages:trafficPackages},selection:{type:selection.type||'general',duration:selection.duration||'30d',packageId:selection.packageId??'',recommendationText:selection.recommendationText??''}},create)}
export function orderSurface(surfaceId:string, order:OrderData, create=true){return wrap(surfaceId,'OrderConfirmCard',{data:path('/payload'),onConfirm:action('confirm_order',{packageId:order.packageId}),onCancel:action('cancel_order')},{payload:order},create)}
export function resultSurface(surfaceId:string, title='办理成功',description='20GB流量包已生效，可在账户总览中查看最新用量。',create=true){return wrap(surfaceId,'ResultCard',{data:path('/payload'),onBack:action('back_account')},{payload:{title,description}},create)}
export function billSurface(surfaceId:string, create=true){return wrap(surfaceId,'BillCard',{data:path('/payload'),onBack:action('back_account')},{payload:bill},create)}
export function analyticsSurface(surfaceId:string, range='30d', create=true, dataOnly=false){if(dataOnly)return [{version:VERSION,updateDataModel:{surfaceId,path:'/filters/range',value:range}}];return wrap(surfaceId,'AnalyticsCard',{data:path('/payload'),selectedRange:path('/filters/range')},{payload:analytics,filters:{range}},create)}

export function findOrder(packageId:string): OrderData | null {const p=trafficPackages.find(x=>x.id===packageId);if(!p)return null;return {packageId:p.id,title:p.title,sizeGb:p.sizeGb,duration:p.duration==='30d'?'30天':'7天',type:p.type==='general'?'通用流量':'定向流量',price:p.price,phone:account.phone}}
export function findOrderByParams(params:Record<string,unknown>):OrderData|null{const p=trafficPackages.find(x=>(params.sizeGb?x.sizeGb===params.sizeGb:true)&&(params.duration?x.duration===params.duration:true)&&(params.type?x.type===params.type:true));return p?findOrder(p.id):null}

function wrap(surfaceId:string, component:string, props:Record<string,unknown>, data:Record<string,unknown>, create:boolean){const messages:any[]=[];if(create)messages.push({version:VERSION,createSurface:{surfaceId,catalogId:TELECOM_CATALOG_ID}});messages.push({version:VERSION,updateComponents:{surfaceId,components:[{id:'root',component,...props}]}});messages.push({version:VERSION,updateDataModel:{surfaceId,path:'/',value:data}});return messages}
