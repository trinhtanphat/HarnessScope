const $ = (q) => document.querySelector(q);
const state = { sessions:[], selected:null, detail:null, tab:'trace', filter:'' };

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function shortTime(iso) { try { return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}); } catch { return ''; } }
function eventDetail(e) {
  const d=e.data||{};
  return d.path || d.name || d.executableName || d.action || d.command || d.url || d.diagnostic || JSON.stringify(d).slice(0,120);
}
function groupEvents(events) {
  const out=[];
  let current=[];
  const bucket=(kind)=> kind.startsWith('File')?'files':kind.startsWith('Tool')?'tools':kind.startsWith('Permission')?'permissions':kind.includes('Marker')?'context':kind.startsWith('Process')?'process':'other';
  for(const e of events){
    const b=bucket(e.kind);
    if(current.length && bucket(current[0].kind)!==b){out.push(current);current=[];}
    current.push(e);
  }
  if(current.length)out.push(current);
  return out;
}
function groupTitle(group){
  const counts={files:0,tools:0,permissions:0,context:0,process:0,other:0};
  for(const e of group){ if(e.kind.startsWith('File'))counts.files++; else if(e.kind==='ToolCall')counts.tools++; else if(e.kind.startsWith('Permission'))counts.permissions++; else if(e.kind.includes('Marker'))counts.context++; else if(e.kind.startsWith('Process'))counts.process++; else counts.other++; }
  const parts=[];
  if(counts.files)parts.push(`${counts.files} file event${counts.files>1?'s':''}`);
  if(counts.tools)parts.push(`${counts.tools} tool call${counts.tools>1?'s':''}`);
  if(counts.permissions)parts.push(`${counts.permissions} permission event${counts.permissions>1?'s':''}`);
  if(counts.context)parts.push(`${counts.context} context marker${counts.context>1?'s':''}`);
  if(counts.process)parts.push(`${counts.process} process event${counts.process>1?'s':''}`);
  if(counts.other)parts.push(`${counts.other} event${counts.other>1?'s':''}`);
  return parts.join(', ');
}
function iconFor(kind){ if(kind.startsWith('File'))return '↗';if(kind.startsWith('Tool'))return '⌘';if(kind.startsWith('Permission'))return '◇';if(kind.includes('Marker'))return '◌';if(kind.startsWith('Process'))return '●';return '·'; }

function renderSessions(){
  $('#sessions').innerHTML=state.sessions.map(s=>`<button class="session-item ${s.id===state.selected?'active':''}" data-session="${s.id}"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.mode)} · ${new Date(s.createdUtc).toLocaleDateString()}</span></button>`).join('') || '<p class="muted">No sessions yet.</p>';
  document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>selectSession(b.dataset.session));
}
function renderFilter(){
  const kinds=[...new Set((state.detail?.events||[]).map(e=>e.kind))].sort();
  $('#kindFilter').innerHTML='<option value="">All event kinds</option>'+kinds.map(k=>`<option ${state.filter===k?'selected':''}>${escapeHtml(k)}</option>`).join('');
}
function renderTrace(){
  if(!state.detail)return;
  const {session,events}=state.detail;
  $('#modeLabel').textContent=(session.mode||'unknown').toUpperCase()+' SESSION';
  $('#sessionTitle').textContent=session.name;
  const shown=events.filter(e=>!state.filter||e.kind===state.filter);
  const fileCount=shown.filter(e=>e.kind.startsWith('File')).length;
  const toolCount=shown.filter(e=>e.kind==='ToolCall').length;
  $('#traceSummary').textContent=`${shown.length} events · ${fileCount} files · ${toolCount} tool calls`;
  $('#traceGroups').innerHTML=groupEvents(shown).map((group,i)=>`<article class="trace-group ${i===0?'open':''}"><div class="group-head"><div class="group-icon">${iconFor(group[0].kind)}</div><div class="group-title"><strong>${escapeHtml(groupTitle(group))}</strong><span>${shortTime(group[0].timestampUtc)} → ${shortTime(group.at(-1).timestampUtc)}</span></div><div class="group-count">${group.length}</div></div><div class="events">${group.map(e=>`<div class="event-row" data-event="${e.id}"><div class="event-time">${shortTime(e.timestampUtc)}</div><div class="event-kind">${escapeHtml(e.kind)}</div><div class="event-detail">${escapeHtml(eventDetail(e))}</div></div>`).join('')}</div></article>`).join('') || '<p class="muted">No matching events.</p>';
  document.querySelectorAll('.group-head').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('open'));
  document.querySelectorAll('[data-event]').forEach(row=>row.onclick=()=>showEvent(row.dataset.event));
}
function renderFindings(){
  const list=state.detail?.findings||[];
  $('#findings').innerHTML=list.map(f=>`<article class="finding" data-finding="${f.id}"><div class="finding-top"><h3>${escapeHtml(f.title)}</h3><span class="badge">${f.confidence>=.9?'INFERRED_HIGH':f.confidence>=.7?'INFERRED_MEDIUM':'UNKNOWN'}</span></div><p>${escapeHtml(f.statement)}</p><div class="confidence"><span style="width:${Math.round(f.confidence*100)}%"></span></div></article>`).join('') || '<p class="muted">No findings yet. Run inference.</p>';
  document.querySelectorAll('[data-finding]').forEach(row=>row.onclick=()=>showFinding(row.dataset.finding));
}
function renderTabs(){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===state.tab));
  $('#traceView').classList.toggle('hidden',!state.detail||state.tab!=='trace');
  $('#specView').classList.toggle('hidden',!state.detail||state.tab!=='spec');
  $('#emptyState').classList.toggle('hidden',!!state.detail);
}
function render(){renderSessions();renderFilter();renderTrace();renderFindings();renderTabs();}
async function selectSession(id){state.selected=id;state.detail=await api(`/api/session/${encodeURIComponent(id)}`);state.filter='';render();}
function openInspector(html){$('#inspectorBody').innerHTML=html;$('.app-shell').classList.add('inspecting');}
function showEvent(id){const e=state.detail.events.find(x=>x.id===id);if(!e)return;openInspector(`<h2 class="inspector-title">${escapeHtml(e.kind)}</h2><div class="kv"><b>Timestamp</b><span>${escapeHtml(e.timestampUtc)}</span></div><div class="kv"><b>Source</b><span>${escapeHtml(e.source)}</span></div><div class="kv"><b>Correlation</b><span>${escapeHtml(e.correlationId||'—')}</span></div><div class="kv"><b>Redaction</b><span>${escapeHtml(e.redaction)}</span></div><div class="json">${escapeHtml(JSON.stringify(e.data,null,2))}</div>`);}
function showFinding(id){const f=state.detail.findings.find(x=>x.id===id);if(!f)return;openInspector(`<h2 class="inspector-title">${escapeHtml(f.title)}</h2><div class="kv"><b>Category</b><span>${escapeHtml(f.category)}</span></div><div class="kv"><b>Confidence</b><span>${Math.round(f.confidence*100)}%</span></div><p class="muted">${escapeHtml(f.statement)}</p><div class="section-label" style="padding:14px 0 6px">EVIDENCE</div>${f.evidenceEventIds.map(id=>`<span class="evidence-chip">${escapeHtml(id)}</span>`).join('')}`);}

$('.tabs').onclick=(e)=>{const t=e.target.closest('.tab');if(!t)return;state.tab=t.dataset.tab;renderTabs();};
$('#kindFilter').onchange=(e)=>{state.filter=e.target.value;renderTrace();};
$('#inferBtn').onclick=async()=>{if(!state.selected)return;$('#inferBtn').textContent='Inferring…';try{await api(`/api/session/${encodeURIComponent(state.selected)}/infer`,{method:'POST'});state.detail=await api(`/api/session/${encodeURIComponent(state.selected)}`);state.tab='spec';render();}finally{$('#inferBtn').textContent='Run inference';}};
$('#closeInspector').onclick=()=>$('.app-shell').classList.remove('inspecting');

state.sessions=await api('/api/sessions');
render();
if(state.sessions[0])selectSession(state.sessions[0].id);
