import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {classify} from './classifier.js';
import {routeClassification} from './router.js';
import {accountSurface, billSurface, findOrder, orderSurface, packagesSurface, resultSurface, trafficDetailSurface} from './a2ui-builder.js';

const app=express();app.use(cors());app.use(express.json());
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const send=async(res:express.Response,items:unknown[])=>{res.setHeader('content-type','application/x-ndjson; charset=utf-8');res.setHeader('cache-control','no-cache');for(const item of items){res.write(JSON.stringify(item)+'\n');await sleep(120)}res.end()};

app.post('/api/chat/stream',async(req,res)=>{try{const message=String(req.body?.message??'');const c=await classify(message);const surfaceId=`assistant-${Date.now()}`;const routed=routeClassification(c,surfaceId);await send(res,[{demoDebug:{...c,skill:routed.skill,taskState:routed.taskState,selectedCard:routed.selectedCard,surfaceId}},...routed.messages]);}catch(e){res.status(500).send(String(e))}});

app.post('/api/action/stream',async(req,res)=>{try{const a=req.body?.action as {name:string;surfaceId:string;context?:Record<string,unknown>};const sid=a.surfaceId;let skill='actionRouter';let taskState='';let selectedCard='';let messages:unknown[]=[];switch(a.name){case 'view_traffic':skill='getTrafficUsage';taskState='view_traffic';selectedCard='TrafficDetailCard';messages=trafficDetailSurface(sid,false);break;case 'view_bill':skill='getBill';taskState='view_bill';selectedCard='BillCard';messages=billSurface(sid,false);break;case 'buy_traffic':skill='getTrafficPackages';taskState='select_package';selectedCard='TrafficPackageCard';messages=packagesSurface(sid,false);break;case 'purchase_traffic_package':{const order=findOrder(String(a.context?.packageId||''));if(!order)throw new Error('Unknown package');skill='buildOrderPreview';taskState='confirm_order';selectedCard='OrderConfirmCard';messages=orderSurface(sid,order,false);break}case 'confirm_order':skill='executeOrder';taskState='completed';selectedCard='ResultCard';messages=resultSurface(sid,undefined,undefined,false);break;case 'cancel_order':case 'back_account':skill='getAccountInfo';taskState='account_overview';selectedCard='AccountOverviewCard';messages=accountSurface(sid,false);break;default:skill='unknownAction';taskState='completed';selectedCard='ResultCard';messages=resultSurface(sid,'暂不支持','这个 Action 还没有接入演示路由。',false)}await send(res,[{demoDebug:{intent:'account_query',parameters:a.context??{},classifier:'mock',skill,taskState,selectedCard,surfaceId:sid}},...messages]);}catch(e){res.status(500).send(String(e))}});

const port=Number(process.env.PORT||8787);app.listen(port,()=>console.log(`A2UI demo server http://localhost:${port}`));
