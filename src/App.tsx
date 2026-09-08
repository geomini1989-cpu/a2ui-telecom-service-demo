import {useEffect, useMemo, useRef, useState} from 'react';
import {MessageProcessor, type A2uiClientAction} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
import {telecomCatalog} from './a2ui/catalog';
import {readNdjson} from './lib/ndjson';
import type {DebugMeta} from './types';

const suggestions = ['查一下我的套餐', '我的流量还剩多少？', '给我办个20G 30天通用流量包', '看看最近业务情况'];

export default function App() {
  const actionRef = useRef<(action: A2uiClientAction) => void>(() => undefined);
  const sessionId = useMemo(() => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);
  const processor = useMemo(() => new MessageProcessor([basicCatalog, telecomCatalog], action => actionRef.current(action)), []);
  const [surfaces, setSurfaces] = useState(() => Array.from(processor.model.surfacesMap.values()));
  const [messages, setMessages] = useState<string[]>(['你好']);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState(true);
  const [debugMeta, setDebugMeta] = useState<DebugMeta | null>(null);
  const [raw, setRaw] = useState<unknown[]>([]);

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const c = processor.onSurfaceCreated(sync);
    const d = processor.onSurfaceDeleted(sync);
    return () => { c.unsubscribe(); d.unsubscribe(); };
  }, [processor]);

  const consumeStream = async (url: string, body: unknown) => {
    const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    await readNdjson(response, item => {
      const obj = item as Record<string, unknown>;
      if (obj.demoDebug) {
        setDebugMeta(obj.demoDebug as unknown as DebugMeta);
        return;
      }
      setRaw(prev => [...prev.slice(-19), item]);
      processor.processMessages([item] as never[]);
    });
  };

  actionRef.current = action => {
    setBusy(true);
    void consumeStream('/api/action/stream', {action, sessionId}).finally(() => setBusy(false));
  };

  const submit = async (value = input) => {
    const text = value.trim();
    if (!text || busy) return;
    setMessages(prev => [...prev, text]);
    setInput('');
    setBusy(true);
    try { await consumeStream('/api/chat/stream', {message: text, sessionId}); }
    finally { setBusy(false); }
  };

  return (
    <main className="page-shell">
      <div className="phone-frame">
        <div className="phone-screen">
          <header className="app-header"><span className="plane">✦</span><strong>AI专属服务</strong><label>调试开关 <input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)} /><i /></label></header>
          <div className="chat-scroll">
            {messages.map((m, i) => <div className="user-bubble" key={`${m}-${i}`}>{m}</div>)}
            {surfaces.map(surface => <div className="assistant-block" key={surface.id}><A2uiSurface surface={surface} /></div>)}
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
          <DebugItem label="Intent" value={debugMeta.intent}/><DebugItem label="Classifier" value={debugMeta.classifier}/><DebugItem label="Skill" value={debugMeta.skill}/><DebugItem label="Task State" value={debugMeta.taskState}/><DebugItem label="Selected Card" value={debugMeta.selectedCard}/><DebugItem label="Surface" value={debugMeta.surfaceId}/>
          <DebugItem label="UI Strategy" value={debugMeta.uiStrategy ?? '-'}/><DebugItem label="Catalog" value={debugMeta.catalog ?? '-'}/>
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
