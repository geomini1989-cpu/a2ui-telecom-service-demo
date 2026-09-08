import type {Classification} from './classifier.js';
import {accountSurface, analyticsSurface, billSurface, findOrderByParams, orderSurface, packagesSurface, resultSurface, trafficDetailSurface} from './a2ui-builder.js';

export function routeClassification(c:Classification,surfaceId:string){
  switch(c.intent){
    case 'traffic_query': return {skill:'getTrafficUsage',taskState:'view_traffic',selectedCard:'TrafficDetailCard',messages:trafficDetailSurface(surfaceId)};
    case 'traffic_purchase': {const direct=findOrderByParams(c.parameters);if(direct && c.parameters.sizeGb && c.parameters.duration && c.parameters.type)return {skill:'getTrafficPackages + buildOrderPreview',taskState:'confirm_order',selectedCard:'OrderConfirmCard',messages:orderSurface(surfaceId,direct)};return {skill:'getTrafficPackages',taskState:'select_package',selectedCard:'TrafficPackageCard',messages:packagesSurface(surfaceId)};}
    case 'bill_query': return {skill:'getBill',taskState:'view_bill',selectedCard:'BillCard',messages:billSurface(surfaceId)};
    case 'business_analysis': {const range=c.parameters.month?'6m':'30d';return {skill:'getBusinessMetrics',taskState:'view_analytics',selectedCard:'AnalyticsCard',messages:analyticsSurface(surfaceId,range)};}
    case 'customer_service': return {skill:'openCustomerService',taskState:'completed',selectedCard:'ResultCard',messages:resultSurface(surfaceId,'已为你连接智能客服','当前为演示环境：真实系统可在这里进入人工/智能客服协同流程。')};
    default:return {skill:'getAccountInfo',taskState:'account_overview',selectedCard:'AccountOverviewCard',messages:accountSurface(surfaceId)};
  }
}
