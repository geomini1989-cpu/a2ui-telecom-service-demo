import {useEffect, useMemo, useRef, useState} from 'react';
import {MessageProcessor, type A2uiClientAction} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
import {telecomCatalog} from './a2ui/catalog';
import {readNdjson} from './lib/ndjson';
import type {DebugMeta} from './types';

const suggestions = ['查一下我的套餐', '我的流量还剩多少？', '给我办个20G 30天通用流量包', '看看最近业务情况'];

type TimelineItem =
  | {id: string; type: 'user'; text: string}
  | {id: string; type: 'surface'; surfaceId: string};

function getSurfaceId(message: Record<string, unknown>) {
  for (const key of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
    const payload = message[key] as {surfaceId?: unknown} | undefined;
    if (typeof payload?.surfaceId === 'string') return payload.surfaceId;
  }
  return undefined;
}

export default function App() {
  const actionRef = useRef<(action: A2uiClientAction) => void>(() => undefined);
  const sessionId = useMemo(() => {
    const saved = localStorage.getItem('telecom-session-id');
    if (saved) return saved;
    const id = `demo-${crypto.randomUUID()}`;
    localStorage.setItem('telecom-session-id', id);
    return id;
  }, []);
  const versionRef = useRef(0);
  const busyRef = useRef(true);
  const processor = useMemo(() => new MessageProcessor([basicCatalog, telecomCatalog], action => actionRef.current(action)), []);
  const [timeline, setTimeline] = useState<TimelineItem[]>([
    {id: 'user-welcome', type: 'user', text: '你好'},
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [debug, setDebug] = useState(true);
  const [debugMeta, setDebugMeta] = useState<DebugMeta | null>(null);
  const [raw, setRaw] = useState<unknown[]>([]);

  const moveSurfaceAfterLatestUser = (surfaceId: string) => {
    setTimeline(prev => [
      ...prev.filter(item => !(item.type === 'surface' && item.surfaceId === surfaceId)),
      {id: `surface-${surfaceId}`, type: 'surface', surfaceId},
    ]);
  };

  const ingest = (item: unknown) => {
    const obj = item as Record<string, unknown>;
    if ('demoDebug' in obj) {
      if (obj.demoDebug) {
        const meta = obj.demoDebug as DebugMeta;
        versionRef.current = meta.sessionVersion ?? versionRef.current;
        setDebugMeta(meta);
      }
      return;
    }
    if (!getSurfaceId(obj)) return;
    const creation = obj.createSurface as {surfaceId:string} | undefined;
    if (creation && Array.from(processor.model.surfacesMap.values()).some(surface => surface.id === creation.surfaceId)) {
      moveSurfaceAfterLatestUser(creation.surfaceId);
      return;
    }
    setRaw(prev => [...prev.slice(-19), item]);
    processor.processMessages([item] as never[]);
    const surfaceId = getSurfaceId(obj);
    if (surfaceId) moveSurfaceAfterLatestUser(surfaceId);
  };

  const restore = async (signal?: AbortSignal) => {
    const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {signal});
    if (!response.ok) throw new Error('恢复会话失败，请稍后重试。');
    const saved = await response.json() as {version: number; history: Array<{role:string;content:string}>; messages:unknown[]};
    if (signal?.aborted) return;
    versionRef.current = saved.version;
    setTimeline(saved.history.filter(item => item.role === 'user').map((item,i) =>
      ({id:`restored-${i}`,type:'user' as const,text:item.content})));
    saved.messages.forEach(ingest);
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void restore(controller.signal).catch(reason => {if (active) setError(String(reason.message));}).finally(() => {
      if (active) {busyRef.current = false; setBusy(false);}
    });
    return () => {active = false; controller.abort();};
  }, [sessionId]);

  const consumeStream = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({error:'请求失败，请稍后重试。'})) as {error?:string};
      if (response.status === 409) await restore();
      throw new Error(detail.error ?? '请求失败，请稍后重试。');
    }
    await readNdjson(response, ingest);
  };

  const perform = async (url: string, body: unknown) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {await consumeStream(url, body);}
    catch (reason) {setError(reason instanceof Error ? reason.message : '请求失败，请稍后重试。');}
    finally {busyRef.current = false; setBusy(false);}
  };
  actionRef.current = action => {void perform('/api/action/stream', {action,sessionId});};

  const submit = async (value = input) => {
    const text = value.trim();
    if (!text || busyRef.current) return;
    setTimeline(prev => [...prev, {id:`user-${crypto.randomUUID()}`,type:'user',text}]);
    setInput('');
    await perform('/api/chat/stream', {message:text,sessionId,expectedVersion:versionRef.current});
  };

  const surfaceById = (surfaceId: string) =>
    processor.model.surfacesMap.get(surfaceId) ??
    Array.from(processor.model.surfacesMap.values()).find(surface => surface.id === surfaceId);

  return (
    <main className="page-shell">
      <div className="phone-frame">
        <div className="phone-screen">
          <header className="app-header"><span className="plane">✦</span><strong>AI专属服务</strong><label>调试开关 <input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)} /><i /></label></header>
          <div className="chat-scroll">
            {timeline.map(item => {
              if (item.type === 'user') {
                return <div className="user-bubble" key={item.id}>{item.text}</div>;
              }
              const surface = surfaceById(item.surfaceId);
              return surface
                ? <div className="assistant-block" key={item.id}><A2uiSurface surface={surface} /></div>
                : null;
            })}
            {busy && <div className="typing">AI 正在处理<span>•••</span></div>}
          </div>
          <div className="composer-wrap">
            {error && <div className="request-error" role="alert">{error}<button disabled={busy} onClick={() => {busyRef.current=true; setBusy(true); void restore().then(() => setError('')).catch(() => setError('恢复失败，请重试。')).finally(() => {busyRef.current=false; setBusy(false);});}}>恢复会话</button></div>}
            <div className="suggestions">{suggestions.slice(0,2).map(s => <button key={s} onClick={()=>submit(s)}>{s}</button>)}<button className="new-session" disabled={busy} onClick={() => {localStorage.removeItem('telecom-session-id'); location.reload();}}>新会话</button></div>
            <form className="composer" onSubmit={e=>{e.preventDefault();void submit();}}><input value={input} onChange={e=>setInput(e.target.value)} placeholder="输入你想查询或办理的内容..." /><button disabled={busy}>发送</button></form>
          </div>
        </div>
      </div>
      {debug && <aside className="debug-panel">
        <div className="debug-header"><div><span>DEMO INSPECTOR</span><h2>A2UI 调试视图</h2></div><b>v0.9.1</b></div>
        {debugMeta ? <div className="debug-grid">
          <DebugItem label="Intent" value={debugMeta.intent}/><DebugItem label="Classifier" value={debugMeta.classifier}/><DebugItem label="LLM Called" value={debugMeta.llmCalled ? 'YES' : 'NO'}/><DebugItem label="LLM Status" value={debugMeta.llmStatus ?? '-'}/><DebugItem label="Skill" value={debugMeta.skill}/><DebugItem label="Task State" value={debugMeta.taskState}/><DebugItem label="Selected Card" value={debugMeta.selectedCard}/><DebugItem label="Surface" value={debugMeta.surfaceId}/>
          <DebugItem label="UI Strategy" value={debugMeta.uiStrategy ?? '-'}/><DebugItem label="Catalog" value={debugMeta.catalog ?? '-'}/>
          <DebugItem label="Agent" value={debugMeta.agentName ?? '-'}/><DebugItem label="Agent Mode" value={debugMeta.agentMode ?? '-'}/>
          <div className="debug-wide"><label>Workflow</label><pre>{JSON.stringify(debugMeta.workflow ?? {},null,2)}</pre></div>
          <div className="debug-wide"><label>Agent Trace</label><pre>{JSON.stringify(debugMeta.agentTrace ?? [],null,2)}</pre></div>
          <div className="debug-wide"><label>Agent Decision</label><pre>{JSON.stringify(debugMeta.agentDecision ?? {},null,2)}</pre></div>
          <div className="debug-wide"><label>Extracted Parameters</label><pre>{JSON.stringify(debugMeta.parameters,null,2)}</pre></div>
          <div className="debug-wide"><label>Merged Slots</label><pre>{JSON.stringify(debugMeta.mergedSlots ?? {},null,2)}</pre></div>
          <div className="debug-wide"><label>Planner Decision</label><pre>{JSON.stringify(debugMeta.plannerDecision ?? {},null,2)}</pre></div>
          <div className="debug-wide"><label>Task Context</label><pre>{JSON.stringify(debugMeta.context ?? {},null,2)}</pre></div>
        </div> : <p className="empty-debug">输入一句话后，这里会展示 Intent → Skill → Card → Surface。</p>}
        <div className="protocol-log"><div className="protocol-title"><h3>A2UI Messages</h3><span>{raw.length}</span></div>{raw.slice(-6).map((m,i)=><pre key={i}>{JSON.stringify(m,null,2)}</pre>)}</div>
      </aside>}
    </main>
  );
}

function DebugItem({label,value}:{label:string;value:string}) {return <div className="debug-item"><label>{label}</label><strong>{value}</strong></div>}
