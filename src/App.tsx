import {useMemo, useRef, useState} from 'react';
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
  const sessionId = useMemo(() => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);
  const processor = useMemo(() => new MessageProcessor([basicCatalog, telecomCatalog], action => actionRef.current(action)), []);
  const [timeline, setTimeline] = useState<TimelineItem[]>([
    {id: 'user-welcome', type: 'user', text: '你好'},
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState(true);
  const [debugMeta, setDebugMeta] = useState<DebugMeta | null>(null);
  const [raw, setRaw] = useState<unknown[]>([]);

  const moveSurfaceAfterLatestUser = (surfaceId: string) => {
    setTimeline(prev => [
      ...prev.filter(item => !(item.type === 'surface' && item.surfaceId === surfaceId)),
      {id: `surface-${surfaceId}`, type: 'surface', surfaceId},
    ]);
  };

  const consumeStream = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());

    await readNdjson(response, item => {
      const obj = item as Record<string, unknown>;
      if (obj.demoDebug) {
        setDebugMeta(obj.demoDebug as unknown as DebugMeta);
        return;
      }

      setRaw(prev => [...prev.slice(-19), item]);
      processor.processMessages([item] as never[]);

      const surfaceId = getSurfaceId(obj);
      if (surfaceId) moveSurfaceAfterLatestUser(surfaceId);
    });
  };

  actionRef.current = action => {
    setBusy(true);
    void consumeStream('/api/action/stream', {action, sessionId}).finally(() => setBusy(false));
  };

  const submit = async (value = input) => {
    const text = value.trim();
    if (!text || busy) return;

    setTimeline(prev => [
      ...prev,
      {id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: 'user', text},
    ]);
    setInput('');
    setBusy(true);

    try {
      await consumeStream('/api/chat/stream', {message: text, sessionId});
    } finally {
      setBusy(false);
    }
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
            <div className="suggestions">{suggestions.slice(0,2).map(s => <button key={s} onClick={()=>submit(s)}>{s}</button>)}</div>
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
