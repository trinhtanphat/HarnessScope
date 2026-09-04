import { createDataClient } from './data-client.js';

const $ = (q) => document.querySelector(q);
const client = createDataClient({ bridge: globalThis.harnesscope ?? null, fetchImpl: globalThis.fetch?.bind(globalThis) });
const state = { sessions:[], selected:null, detail:null, tab:'trace', filter:'', busy:false, appInfo:null };
let toastTimer = null;

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
function safeError(error) { return error?.message || 'The operation could not be completed.'; }

function showToast(message, tone='info') {
  const toast=$('#toast');
  toast.textContent=message;
  toast.dataset.tone=tone;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('visible'),3600);
}

function setBusy(value, label='Working…') {
  state.busy=value;
  document.body.classList.toggle('busy',value);
  document.querySelectorAll('[data-operation], #inferBtn').forEach((control)=>{
    control.disabled=value || (control.dataset.native==='true' && client.mode!=='desktop');
  });
  $('#busyLabel').textContent=value?label:'';
}

async function runOperation(label, fn, { refresh=false, success=null }={}) {
  if(state.busy)return null;
  setBusy(true,label);
  try {
    const value=await fn();
    if(refresh) await refreshSessionsAndDetail();
    if(success && !value?.cancelled) showToast(success,'success');
    return value;
  } catch(error) {
    showToast(safeError(error),'error');
    return null;
  } finally {
    setBusy(false);
    renderNativeState();
  }
}

function renderSessions(){
  $('#sessions').innerHTML=state.sessions.map(s=>`<button class="session-item ${s.id===state.selected?'active':''}" data-session="${escapeHtml(s.id)}"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.mode)} · ${new Date(s.createdUtc).toLocaleDateString()}</span></button>`).join('') || '<p class="muted">No sessions yet.</p>';
  document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>selectSession(b.dataset.session));
}
function renderFilter(){
  const kinds=[...new Set((state.detail?.events||[]).map(e=>e.kind))].sort();
  $('#kindFilter').innerHTML='<option value="">All event kinds</option>'+kinds.map(k=>`<option value="${escapeHtml(k)}" ${state.filter===k?'selected':''}>${escapeHtml(k)}</option>`).join('');
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
  $('#traceGroups').innerHTML=groupEvents(shown).map((group,i)=>`<article class="trace-group ${i===0?'open':''}"><div class="group-head"><div class="group-icon">${iconFor(group[0].kind)}</div><div class="group-title"><strong>${escapeHtml(groupTitle(group))}</strong><span>${shortTime(group[0].timestampUtc)} → ${shortTime(group.at(-1).timestampUtc)}</span></div><div class="group-count">${group.length}</div></div><div class="events">${group.map(e=>`<div class="event-row" data-event="${escapeHtml(e.id)}"><div class="event-time">${shortTime(e.timestampUtc)}</div><div class="event-kind">${escapeHtml(e.kind)}</div><div class="event-detail">${escapeHtml(eventDetail(e))}</div></div>`).join('')}</div></article>`).join('') || '<p class="muted">No matching events.</p>';
  document.querySelectorAll('.group-head').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('open'));
  document.querySelectorAll('[data-event]').forEach(row=>row.onclick=()=>showEvent(row.dataset.event));
}
function renderFindings(){
  const list=state.detail?.findings||[];
  $('#findings').innerHTML=list.map(f=>`<article class="finding" data-finding="${escapeHtml(f.id)}"><div class="finding-top"><h3>${escapeHtml(f.title)}</h3><span class="badge">${f.confidence>=.9?'INFERRED_HIGH':f.confidence>=.7?'INFERRED_MEDIUM':'UNKNOWN'}</span></div><p>${escapeHtml(f.statement)}</p><progress class="confidence" max="1" value="${Number.isFinite(f.confidence)?Math.max(0,Math.min(1,f.confidence)):0}"></progress></article>`).join('') || '<p class="muted">No findings yet. Run inference.</p>';
  document.querySelectorAll('[data-finding]').forEach(row=>row.onclick=()=>showFinding(row.dataset.finding));
}
function renderTabs(){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===state.tab));
  $('#traceView').classList.toggle('hidden',!state.detail||state.tab!=='trace');
  $('#specView').classList.toggle('hidden',!state.detail||state.tab!=='spec');
  $('#emptyState').classList.toggle('hidden',!!state.detail);
}
function renderNativeState(){
  const desktop=client.mode==='desktop';
  const selected=!!state.selected;
  $('#platformBadge').textContent=state.appInfo ? `${state.appInfo.platform}${state.appInfo.version?` · v${state.appInfo.version}`:''}` : client.mode;
  $('#platformBadge').dataset.mode=client.mode;
  $('#newSessionBtn').disabled=state.busy||!desktop;
  ['importBtn','launchBtn','compareBtn','exportBtn'].forEach((id)=>{$(`#${id}`).disabled=state.busy||!desktop||!selected;});
  $('#inferBtn').disabled=state.busy||!selected;
  $('#importType').disabled=state.busy||!desktop||!selected;
  $('.sidebar-foot').title=desktop?'Electron userData workspace':'Local browser workspace';
}
function render(){renderSessions();renderFilter();renderTrace();renderFindings();renderTabs();renderNativeState();}

async function selectSession(id){
  if(state.busy)return;
  state.selected=id;
  try {
    state.detail=await client.getTimeline(id);
    state.filter='';
    render();
  } catch(error) { showToast(safeError(error),'error'); }
}
async function refreshSessionsAndDetail(){
  state.sessions=await client.listSessions();
  if(state.selected && !state.sessions.some((session)=>session.id===state.selected)) state.selected=null;
  if(state.selected) state.detail=await client.getTimeline(state.selected);
  else state.detail=null;
  render();
}
function openInspector(html){$('#inspectorBody').innerHTML=html;$('.app-shell').classList.add('inspecting');}
function showEvent(id){const e=state.detail.events.find(x=>x.id===id);if(!e)return;openInspector(`<h2 class="inspector-title">${escapeHtml(e.kind)}</h2><div class="kv"><b>Timestamp</b><span>${escapeHtml(e.timestampUtc)}</span></div><div class="kv"><b>Source</b><span>${escapeHtml(e.source)}</span></div><div class="kv"><b>Correlation</b><span>${escapeHtml(e.correlationId||'—')}</span></div><div class="kv"><b>Redaction</b><span>${escapeHtml(e.redaction)}</span></div><div class="json">${escapeHtml(JSON.stringify(e.data,null,2))}</div>`);}
function showFinding(id){const f=state.detail.findings.find(x=>x.id===id);if(!f)return;openInspector(`<h2 class="inspector-title">${escapeHtml(f.title)}</h2><div class="kv"><b>Category</b><span>${escapeHtml(f.category)}</span></div><div class="kv"><b>Confidence</b><span>${Math.round(f.confidence*100)}%</span></div><p class="muted">${escapeHtml(f.statement)}</p><div class="evidence-title section-label">EVIDENCE</div>${f.evidenceEventIds.map(eventId=>`<span class="evidence-chip">${escapeHtml(eventId)}</span>`).join('')}`);}
function dialogOpen(id){const dialog=$(`#${id}`);if(typeof dialog.showModal==='function')dialog.showModal();}
function dialogClose(id){const dialog=$(`#${id}`);if(dialog.open)dialog.close();}
function populateCompareSelects(){
  const options=state.sessions.map((s)=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.mode)})</option>`).join('');
  $('#compareA').innerHTML=options;
  $('#compareB').innerHTML=options;
  if(state.selected){$('#compareA').value=state.selected;const other=state.sessions.find((s)=>s.id!==state.selected);if(other)$('#compareB').value=other.id;}
}

$('.tabs').onclick=(e)=>{const t=e.target.closest('.tab');if(!t)return;state.tab=t.dataset.tab;renderTabs();};
$('#kindFilter').onchange=(e)=>{state.filter=e.target.value;renderTrace();};
$('#closeInspector').onclick=()=>$('.app-shell').classList.remove('inspecting');

document.querySelectorAll('[data-dialog-close]').forEach((button)=>button.onclick=()=>dialogClose(button.dataset.dialogClose));

$('#inferBtn').onclick=()=>runOperation('Running inference…',async()=>{
  await client.runInference(state.selected);
  state.detail=await client.getTimeline(state.selected);
  state.tab='spec';
  render();
},{success:'Inference updated.'});

$('#newSessionBtn').onclick=()=>dialogOpen('newSessionDialog');
$('#newSessionForm').onsubmit=(event)=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  runOperation('Creating session…',async()=>{
    const created=await client.createSession({name:String(form.get('name')||''),mode:String(form.get('mode')||'desktop')});
    state.selected=created.id;
    dialogClose('newSessionDialog');
    event.currentTarget.reset();
  },{refresh:true,success:'Session created.'});
};

$('#importBtn').onclick=()=>runOperation('Importing evidence…',async()=>{
  const result=await client.importEvidence($('#importType').value,state.selected);
  if(!result?.cancelled) state.detail=await client.getTimeline(state.selected);
  render();
  return result;
},{success:'Evidence imported.'});

$('#launchBtn').onclick=()=>dialogOpen('launchDialog');
$('#launchForm').onsubmit=(event)=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const args=String(form.get('args')||'').split(/\r?\n/).map((value)=>value.trim()).filter(Boolean);
  const request={target:String(form.get('target')||''),args};
  const cwd=String(form.get('cwd')||'').trim();
  if(cwd)request.cwd=cwd;
  runOperation('Observing launched process…',async()=>{
    const result=await client.launch(state.selected,request);
    dialogClose('launchDialog');
    state.detail=await client.getTimeline(state.selected);
    render();
    return result;
  },{success:'Observed process completed.'});
};

$('#compareBtn').onclick=()=>{populateCompareSelects();dialogOpen('compareDialog');};
$('#compareForm').onsubmit=(event)=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  runOperation('Comparing sessions…',async()=>{
    const result=await client.runCompare(String(form.get('sessionA')),String(form.get('sessionB')));
    dialogClose('compareDialog');
    state.tab='spec';
    renderTabs();
    openInspector(`<h2 class="inspector-title">Session comparison</h2><div class="json">${escapeHtml(JSON.stringify(result,null,2))}</div>`);
    return result;
  },{success:'Session comparison ready.'});
};

$('#exportBtn').onclick=()=>runOperation('Exporting clean-room spec…',()=>client.exportSession(state.selected),{success:'Behavioral spec exported.'});

async function initialize(){
  try{state.appInfo=await client.appInfo();}catch{state.appInfo={platform:client.mode,version:null};}
  try{
    state.sessions=await client.listSessions();
    render();
    if(state.sessions[0])await selectSession(state.sessions[0].id);
    if(client.mode!=='desktop')showToast('Browser mode: native actions are available in HarnessScope Desktop.');
  }catch(error){showToast(safeError(error),'error');render();}
}

await initialize();
