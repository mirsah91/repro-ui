import React, {useMemo, useState, useCallback} from "react";

// --- Utilities ---
const asNumber = (v, fb=0)=>{ const n = Number(v); return Number.isFinite(n) ? n : fb; };

const normalizeTrace = (trace)=> trace
    .filter(Boolean)
    .map((e,i)=>({
      ...e,
      index: i,
      type: typeof e.type === 'string' ? e.type.toLowerCase() : e.type,
      depth: asNumber(e.depth),
      time: asNumber(e.t, i),
    }))
    .sort((a,b)=> a.time!==b.time ? a.time-b.time : (a.depth!==b.depth ? a.depth-b.depth : a.index-b.index));

function buildCallTree(events){
  const stack = [];
  const roots = [];
  for (const event of events){
    if (event.type === 'enter'){
      const call = { id: `call-${event.index}`, enter: event, exit: null, children: [] };
      if (stack.length) stack[stack.length-1].children.push(call); else roots.push(call);
      stack.push(call);
      continue;
    }
    if (event.type === 'exit'){
      const call = stack.pop();
      if (!call){ // orphan exit
        roots.push({ id: `orphan-exit-${event.index}`, enter: null, exit: event, children: [], orphan: true });
      } else { call.exit = event; }
      continue;
    }
    // other event type – attach as child event node
    const node = { id: `event-${event.index}`, enter: event, exit: null, children: [], isEventOnly: true };
    if (stack.length) stack[stack.length-1].children.push(node); else roots.push(node);
  }
  return roots;
}

// JSON preview that is safe for any shape and keeps UI compact.
function previewJSON(value){
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  try{ const s = JSON.stringify(value, replacer, 2); return s; }
  catch{ return String(value); }
}
function replacer(_k, v){
  if (typeof v === 'function') return '[Function]';
  if (typeof v === 'bigint') return String(v)+'n';
  if (v && typeof v === 'object'){
    if (v.__type === 'Buffer' && Number.isFinite(v.length)) return `[Buffer ${v.length}]`;
    // DO NOT collapse custom classes; show full shape
  }
  return v;
}

function trimPath(file){ if (!file) return 'unknown'; const parts = String(file).split(/[\\/]/).filter(Boolean); return parts.slice(-3).join('/'); }
function fmtDur(start, end){ if (!Number.isFinite(start)||!Number.isFinite(end)) return null; const d=end-start; if (d<0) return null; if (d<1) return (d*1000).toFixed(2)+' µs'; if (d<1000) return d.toFixed(2)+' ms'; return (d/1000).toFixed(2)+' s'; }

// --- UI Bits ---
function Badge({children}){ return <span style={{fontSize:12,padding:'2px 6px',borderRadius:8,border:'1px solid var(--ui-border)',background:'var(--ui-bg-2)'}}>{children}</span>; }
function Row({children, depth, selected, onClick}){
  return (
      <div onClick={onClick} style={{
        marginLeft: depth*14,
        border:'1px solid var(--ui-border)',
        borderRadius:12,
        padding:12,
        background: selected? 'var(--ui-bg-sel)':'var(--ui-bg-1)',
        boxShadow:'var(--ui-shadow)'
      }}>{children}</div>
  );
}

function Section({label, children, error}){
  return (
      <div style={{marginTop:8}}>
        <div style={{fontSize:12,opacity:.7,marginBottom:4,color: error? 'var(--ui-red)': 'inherit'}}>{label}</div>
        <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',margin:0,fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',fontSize:12,background:'var(--ui-code-bg)',padding:8,borderRadius:8,border:'1px solid var(--ui-border)'}}>{children}</pre>
      </div>
  );
}

function Toggle({checked,onChange,label}){
  return (
      <label style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer'}}>
        <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} />
        <span style={{fontSize:13}}>{label}</span>
      </label>
  );
}

function CallNode({call, depth, compact, showFull}){
  const enter = call.enter; const exit = call.exit;
  const name = enter?.fn || exit?.fn || '(anonymous)';
  const locationFile = enter?.file || exit?.file; const locationLine = (enter?.line ?? exit?.line);
  const location = `${trimPath(locationFile)}${locationLine!=null? ':'+locationLine: ''}`;
  const duration = enter && exit ? fmtDur(enter.time, exit.time) : null;
  const [open, setOpen] = useState(depth <= 1);

  const hasChildren = call.children?.length>0;
  const isError = Boolean(exit?.error || exit?.threw);

  return (
      <div style={{marginTop:10}}>
        <Row depth={depth} selected={false}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
              {hasChildren && (
                  <button onClick={()=>setOpen(o=>!o)} title={open? 'Collapse':'Expand'} style={{border:'1px solid var(--ui-border)',background:'var(--ui-bg-2)',borderRadius:8,padding:'2px 6px'}}> {open? '−':'+'} </button>
              )}
              <div style={{display:'grid',gap:2,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                  <strong style={{fontWeight:600,whiteSpace:'normal'}}>{name}</strong>
                  {enter?.type && <Badge>{enter.type}</Badge>}
                  {isError && <Badge>error</Badge>}
                </div>
                <div style={{fontSize:12,opacity:.8,overflow:'hidden',textOverflow:'ellipsis'}}>{location}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {duration && <Badge>{duration}</Badge>}
              {Number.isFinite(enter?.time) && Number.isFinite(exit?.time) && (
                  <div title="Duration bar" style={{width:120,height:6,background:'var(--ui-bg-2)',borderRadius:6,overflow:'hidden',border:'1px solid var(--ui-border)'}}>
                    <div style={{width:'100%',height:'100%',transformOrigin:'left',transform:`scaleX(${Math.min(1, Math.max(0, (exit.time-enter.time)/(eventsGlobal.maxDur||1)))})`}} />
                  </div>
              )}
            </div>
          </div>
          {!compact && (
              <div style={{marginTop:8}}>
                {!call.isEventOnly && <Section label="Arguments">{formatArgs(enter?.args, showFull)}</Section>}
                {exit && exit.returnValue !== undefined && <Section label="Return value">{previewJSON(exit.returnValue, showFull ? 100000 : 180)}</Section>}
                {exit && (exit.error || exit.threw) && <Section label={exit.threw? 'Threw':'Error'} error>{previewJSON(exit.error, showFull ? 100000 : 180)}</Section>}
                {call.isEventOnly && <Section label="Event">{previewJSON(enter, showFull ? 100000 : 180)}</Section>}
              </div>
          )}
        </Row>
        {open && hasChildren && (
            <div>
              {call.children.map(ch => <CallNode key={ch.id} call={ch} depth={depth+1} compact={compact} />)}
            </div>
        )}
      </div>
  );
}

function formatArgs(args, showFull){
  const limit = showFull ? 100000 : 180;
  if (!args || args.length===0) return '—';
  if (!Array.isArray(args)) return previewJSON(args, limit);
  return args.map((a,i)=> args.length===1 ? previewJSON(a, limit) : `${i+1}. ${previewJSON(a, limit)}`).join('');
}

// global for simple duration bar scaling
const eventsGlobal = { maxDur: 0 };

export function FunctionTraceViewer({ trace = [], title = 'Function trace' }){
  const events = useMemo(()=> normalizeTrace(trace), [trace]); useMemo(()=> normalizeTrace(trace), [trace]);
  const calls = useMemo(()=> buildCallTree(events), [events]);

  // compute max duration among matched enter/exit for bar scaling
  eventsGlobal.maxDur = 0;
  for (const e of calls){
    const walk = (n)=>{ if (n.enter && n.exit) eventsGlobal.maxDur = Math.max(eventsGlobal.maxDur, (n.exit.time - n.enter.time)||0); (n.children||[]).forEach(walk); };
    walk(e);
  }

  const [q, setQ] = useState('');
  const [compact, setCompact] = useState(false);
  const [showFull, setShowFull] = useState(true);
  const [hideEvents, setHideEvents] = useState(true);

  const filtered = useMemo(()=>{
    const needle = q.trim().toLowerCase();
    const match = (n)=>{
      const enter = n.enter || {}; const exit = n.exit || {};
      const fn = (enter.fn || exit.fn || '').toLowerCase();
      const file = (enter.file || exit.file || '').toLowerCase();
      const ok = (!needle || fn.includes(needle) || file.includes(needle));
      const visible = ok && (!hideEvents || !n.isEventOnly);
      if (!n.children || n.children.length===0) return visible;
      return visible || n.children.some(match);
    };
    return calls.filter(match);
  }, [calls, q, hideEvents]);

  return (
      <div style={{
        '--ui-bg-1':'#0b0d10',
        '--ui-bg-2':'#15191f',
        '--ui-bg-sel':'#101520',
        '--ui-code-bg':'#0e1116',
        '--ui-border':'#2a3240',
        '--ui-shadow':'0 1px 0 rgba(0,0,0,.2)',
        '--ui-red':'#e45b5b',
        color:'#d8dee9', background:'var(--ui-bg-1)', padding:16, borderRadius:16
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,gap:12}}>
          <div style={{display:'flex',alignItems:'baseline',gap:12}}>
            <h2 style={{margin:0,fontSize:18}}>{title}</h2>
            <span style={{opacity:.8,fontSize:13}}>{filtered.length} root call{filtered.length===1?'':'s'}</span>
          </div>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter by fn/file…" style={{background:'var(--ui-bg-2)',color:'inherit',border:'1px solid var(--ui-border)',borderRadius:10,padding:'6px 10px'}}/>
            <Toggle checked={compact} onChange={setCompact} label="Compact" />
            <Toggle checked={hideEvents} onChange={setHideEvents} label="Hide event-only" />
            <Toggle checked={showFull} onChange={setShowFull} label="Show full values" />
          </div>
        </div>

        {filtered.length===0 ? (
            <div style={{opacity:.8}}>No trace events</div>
        ) : (
            <div>
              {filtered.map(call => (
                  <CallNode key={call.id} call={call} depth={0} compact={compact} showFull={showFull} />
              ))}
            </div>
        )}
      </div>
  );
}

