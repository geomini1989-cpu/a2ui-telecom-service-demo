import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TelecomStore} from './database.js';
import {TelecomWorkflow} from './workflow.js';
import {runSkill} from './skills/registry.js';
import {createApp} from './app.js';
import {trafficPackages} from './mock-data.js';
import type {Server} from 'node:http';

let directory: string;
let store: TelecomStore;
let workflow: TelecomWorkflow;
let httpServer: Server | undefined;
beforeEach(() => {
  vi.stubEnv('LLM_MODE','mock');
  directory=mkdtempSync(join(tmpdir(),'a2ui-workflow-'));
  store=new TelecomStore(directory); workflow=new TelecomWorkflow(store);
});
afterEach(async () => {
  if (httpServer) await new Promise<void>(resolve => httpServer!.close(() => resolve()));
  httpServer=undefined; store.close(); rmSync(directory,{recursive:true,force:true}); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
async function chat(message: string, id='test') {
  return workflow.run(id,{kind:'chat',message,expectedVersion:store.getSession(id).version});
}
function action(name: string, extra: Record<string,unknown>={}, id='test') {
  const s=store.getSession(id);
  return {name,surfaceId:s.surfaceId!,context:{sessionVersion:s.version,...(s.pendingOrder?{pendingOrderId:s.pendingOrder.id}:{}),...extra}};
}
async function select(packageId='g30-20', id='test') {
  await chat('给我办个20G 30天通用流量包',id);
  return workflow.run(id,{kind:'action',action:action('purchase_traffic_package',{packageId},id)});
}
function debug(messages: unknown[]) {return (messages[0] as {demoDebug:Record<string,any>}).demoDebug;}
function confirm(id='test') {return action('confirm_order',{packageId:store.getSession(id).pendingOrder!.order.packageId},id);}

describe('durable telecom workflow',() => {
  it('runs a real graph and restores confirmation after closing/reopening SQLite',async () => {
    const preview=await select();
    expect(debug(preview).workflow.engine).toBe('langgraph');
    expect(debug(preview).workflow.nodes).toEqual(['understand','plan_ui','prepare_order']);
    const button=confirm(); const pending=store.getSession('test').pendingOrder!.id;
    expect((await workflow.graph.getState({configurable:{thread_id:store.getSession('test').workflowId}})).next).toEqual(['await_confirmation']);
    store.close(); store=new TelecomStore(directory); workflow=new TelecomWorkflow(store);
    const restored=await workflow.restore('test');
    expect(restored.messages.some((m:any)=>m.createSurface)).toBe(true);
    expect(store.getSession('test').pendingOrder!.id).toBe(pending);
    const result=await workflow.run('test',{kind:'action',action:button});
    expect(debug(result).taskState).toBe('completed');
    expect(debug(result).workflow.nodes).toContain('await_confirmation');
    expect(debug(result).workflow.nodes).toContain('execute_order');
    expect(store.getSession('test').balanceCents).toBe(3880);
    expect((await workflow.graph.getState({configurable:{thread_id:store.getSession('test').workflowId}})).next).toEqual([]);
  });
  it('makes duplicate concurrent confirmation return one receipt and one debit',async () => {
    await select(); const button=confirm();
    const [a,b]=await Promise.all([workflow.run('test',{kind:'action',action:button}),workflow.run('test',{kind:'action',action:button})]);
    expect(debug(a).plannerDecision.orderId).toBe(debug(b).plannerDecision.orderId);
    expect(store.getSession('test').balanceCents).toBe(3880);
    expect(store.db.prepare("SELECT count(*) AS n FROM orders WHERE status='completed'").get()!.n).toBe(1);
  });
  it('rejects stale cards and cross-session confirmation',async () => {
    await select(); const old=confirm();
    await workflow.run('test',{kind:'action',action:action('cancel_order')});
    await select('g30-30');
    await expect(workflow.run('test',{kind:'action',action:old})).rejects.toMatchObject({status:409});
    await select('g30-20','other');
    await expect(workflow.run('other',{kind:'action',action:confirm('test')})).rejects.toMatchObject({status:409});
    expect(store.getSession('test').balanceCents).toBe(5680);
    expect(store.getSession('other').balanceCents).toBe(5680);
  });
  it('cannot execute without confirmation or a matching immutable package',async () => {
    await chat('给我办个20G 30天通用流量包');
    await expect(workflow.run('test',{kind:'action',action:action('confirm_order',{packageId:'g30-20'})})).rejects.toMatchObject({status:409});
    await select();
    await expect(workflow.run('test',{kind:'action',action:action('confirm_order',{packageId:'g30-100'})})).rejects.toMatchObject({status:409});
    await expect(runSkill('executeOrder',{packageId:'g30-20'},store.getSession('test'))).rejects.toThrow('requires explicit authorization');
    expect(store.getSession('test').balanceCents).toBe(5680);
  });
  it('recovers insufficient balance using the authoritative account balance',async () => {
    await select('g30-100');
    expect(store.getSession('test').taskState).toBe('insufficient_balance');
    expect(store.getSession('test').pendingOrder).toBeUndefined();
    const result=await workflow.run('test',{kind:'action',action:action('show_affordable_packages',{maxPrice:100000})});
    expect(debug(result).taskState).toBe('select_package');
    const payload=(result.find((m:any)=>m.updateDataModel?.path==='/') as any).updateDataModel.value;
    expect(payload.payload.packages.every((p:any)=>p.price<=56.8)).toBe(true);
  });
  it('revalidates balance at execution and does not commit an unaffordable order',async () => {
    await select(); const button=confirm();
    const session=store.getSession('test'); session.balanceCents=0; store.save(session);
    const recovered=await workflow.run('test',{kind:'action',action:button});
    expect(debug(recovered).taskState).toBe('insufficient_balance');
    expect(store.getSession('test').pendingOrder).toBeUndefined();
    expect(store.receipt('test',session.pendingOrder!.id)).toBeUndefined();
    expect(store.getSession('test').balanceCents).toBe(0);
  });
  it('supports exact natural-language confirmation, cancellation and unrelated text safely',async () => {
    await select(); const version=store.getSession('test').version;
    await chat('好的'); expect(store.getSession('test').taskState).toBe('confirm_order');
    expect(store.getSession('test').version).toBe(version);
    await chat('取消'); expect(store.getSession('test').pendingOrder).toBeUndefined();
    await select(); const result=await chat('确认办理'); expect(debug(result).taskState).toBe('completed');
  });
  it('recovers a receipt when the process stops after the ledger commit',async () => {
    await select(); const session=store.getSession('test');
    const receipt=store.execute(session,session.pendingOrder!.id);
    store.close(); store=new TelecomStore(directory); workflow=new TelecomWorkflow(store);
    const restored=await workflow.restore('test');
    expect((restored.messages[0] as any).demoDebug.taskState).toBe('completed');
    expect(JSON.stringify(restored.messages)).toContain(receipt.orderId.replace('DEMO-',''));
    expect(store.getSession('test').balanceCents).toBe(3880);
  });
  it('isolates session ledgers and shows the post-order balance in the account UI',async () => {
    await select(); await workflow.run('test',{kind:'action',action:confirm()});
    await workflow.run('test',{kind:'action',action:action('back_account')});
    const restored=await workflow.restore('test');
    expect(JSON.stringify(restored.messages)).toContain('38.8');
    expect(store.getSession('other').balanceCents).toBe(5680);
  });
  it('retains the deterministic fallback when the configured model fails',async () => {
    vi.stubEnv('LLM_MODE','openai-compatible');vi.stubEnv('LLM_API_KEY','test-key');vi.stubEnv('LLM_MODEL','test-model');
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('model unavailable')));
    const result=await chat('查一下我的套餐');
    expect(debug(result).agentMode).toBe('deterministic_fallback');
    expect(debug(result).selectedCard).toBe('AccountOverviewCard');
  });

  it('executes a native model/tool/observation loop before UI planning',async () => {
    vi.stubEnv('LLM_MODE','openai-compatible');vi.stubEnv('LLM_API_KEY','test-key');vi.stubEnv('LLM_MODEL','test-model');
    const llm=vi.fn().mockImplementationOnce(async () => new Response(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[
      {id:'lookup',type:'function',function:{name:'getTrafficPackages',arguments:JSON.stringify({sizeGb:20,duration:'30d',type:'general'})}},
      {id:'balance',type:'function',function:{name:'validateBalance',arguments:JSON.stringify({packageId:'g30-20'})}},
    ]}}]}))).mockImplementationOnce(async (_url,init) => {
      const body=JSON.parse(init.body);
      expect(body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.tool_call_id)).toEqual(['lookup','balance']);
      return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({intent:'traffic_purchase',
        parameters:{sizeGb:20,duration:'30d',type:'general',recommendedPackageId:'g30-20'},decision:{summary:'匹配用户需求'}})}}]}));
    });
    vi.stubGlobal('fetch',llm);
    const result=await chat('给我20G流量');
    expect(debug(result).agentMode).toBe('llm_tool_calling');expect(llm).toHaveBeenCalledTimes(2);
    expect(debug(result).agentTrace.filter((t:any)=>t.kind==='skill')).toHaveLength(2);
    expect(store.getSession('test').taskState).toBe('select_package');expect(store.getSession('test').pendingOrder).toBeUndefined();
  });
  it('rejects a model request to execute an order autonomously',async () => {
    vi.stubEnv('LLM_MODE','openai-compatible');vi.stubEnv('LLM_API_KEY','test-key');vi.stubEnv('LLM_MODEL','test-model');
    const llm=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[
      {id:'forbidden',type:'function',function:{name:'executeOrder',arguments:'{"packageId":"g30-20"}'}},
    ]}}]}))).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'{"intent":"account_query","parameters":{},"decision":{}}'}}]})));
    vi.stubGlobal('fetch',llm);
    const result=await chat('帮我办流量');
    expect(debug(result).agentTrace.some((t:any)=>t.label==='Rejected tool call')).toBe(true);
    expect(store.db.prepare('SELECT count(*) AS n FROM orders').get()!.n).toBe(0);
    expect(store.getSession('test').balanceCents).toBe(5680);
  });
  it('requires a new selection when the catalog price changes after preview',async () => {
    await select();const button=confirm();const item=trafficPackages.find(p=>p.id==='g30-20')!;const original=item.price;
    try {
      item.price=19;
      const result=await workflow.run('test',{kind:'action',action:button});
      expect(debug(result).taskState).toBe('select_package');expect(debug(result).plannerDecision.executionBlocked).toBe(true);
      expect(store.getSession('test').balanceCents).toBe(5680);expect(store.getSession('test').pendingOrder).toBeUndefined();
    } finally {item.price=original;}
  });
  it('rejects unknown actions without modifying the current session',async () => {
    await chat('查套餐');const version=store.getSession('test').version;
    await expect(workflow.run('test',{kind:'action',action:action('unknown')})).rejects.toMatchObject({status:400});
    expect(store.getSession('test').version).toBe(version);
  });
  it('reconstructs confirmation UI if the process stopped before presenting it',async () => {
    await select();const session=store.getSession('test');
    session.lastDebug=undefined;session.restoreMessages=[];store.save(session);
    store.close();store=new TelecomStore(directory);workflow=new TelecomWorkflow(store);
    const restored=await workflow.restore('test');
    expect((restored.messages[0] as any).demoDebug.taskState).toBe('confirm_order');
    expect(JSON.stringify(restored.messages)).toContain(session.pendingOrder!.id);
    expect(debug(await workflow.run('test',{kind:'action',action:confirm()})).taskState).toBe('completed');
  });


  it('retains the committed debit when an execution node replays an older checkpoint',async () => {
    await select();const session=store.getSession('test');const checkpoint=structuredClone(session);
    const receipt=store.execute(session,session.pendingOrder!.id);
    expect(store.execute(checkpoint,checkpoint.pendingOrder!.id)).toEqual(receipt);
    expect(checkpoint.balanceCents).toBe(3880);
    store.save(checkpoint);
    expect(store.getSession('test').balanceCents).toBe(3880);
  });
  it('enforces the selected budget even when an Action forges a package',async () => {
    await chat('给我推荐预算最多10元的流量包');
    await expect(workflow.run('test',{kind:'action',action:action('purchase_traffic_package',{packageId:'g30-20'})})).rejects.toMatchObject({status:409});
    expect(store.getSession('test').pendingOrder).toBeUndefined();
    const restored=await workflow.restore('test');
    expect(JSON.stringify(restored.messages)).toContain(`"sessionVersion":${store.getSession('test').version}`);
  });

  it('returns clear HTTP conflicts and exposes a restore endpoint',async () => {
    store.close(); const runtime=createApp(directory); store=runtime.store; workflow=runtime.workflow;
    httpServer=runtime.app.listen(0);
    await new Promise<void>(resolve => httpServer!.once('listening',resolve));
    const address=httpServer.address() as {port:number};const url=`http://127.0.0.1:${address.port}`;
    const response=await fetch(`${url}/api/chat/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'http',message:'查账户',expectedVersion:0})});
    expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('ndjson');await response.text();
    const conflict=await fetch(`${url}/api/chat/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'http',message:'查账户',expectedVersion:0})});
    expect(conflict.status).toBe(409);
    const restored=await fetch(`${url}/api/session/http`).then(r=>r.json());expect(restored.version).toBe(1);
    const invalid=await fetch(`${url}/api/action/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'http'})});
    expect(invalid.status).toBe(400);
  });
});
