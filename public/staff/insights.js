import {STATUSES,TASK_KEYS,completedCount,stats,dateAge,csvSummary} from './insights-core.mjs';
// All reporting and pipeline views operate on applications already retrieved by Phase 2's role-gated API.
// No new endpoints, permissions, or direct client Firestore reads are introduced.
export function initInsights({getRows,getRole,openMerchant,getCursor}){
  const byId=id=>document.getElementById(id);
  const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;return e;};
  const nav=document.querySelectorAll('[data-mm-tab]');
  const views=document.querySelectorAll('[data-mm-view]');
  const selected=()=>[...nav].find(b=>b.getAttribute('aria-selected')==='true')?.dataset.mmTab||'directory';
  function show(name){
    for(const n of nav){const active=n.dataset.mmTab===name;n.setAttribute('aria-selected',String(active));n.tabIndex=active?0:-1;}
    for(const v of views)v.hidden=v.dataset.mmView!==name;
    render();
  }
  nav.forEach((n,index)=>{
    n.addEventListener('click',()=>show(n.dataset.mmTab));
    n.addEventListener('keydown',e=>{
      if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;
      e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?nav.length-1:(index+(e.key==='ArrowRight'?1:-1)+nav.length)%nav.length;
      show(nav[next].dataset.mmTab);nav[next].focus();
    });
  });
  function caution(){
    const message=getCursor()?'More applications exist. Load additional pages in Directory to extend these totals.':'Totals include all applications loaded in this session.';
    byId('mmScopePipeline').textContent=message;
    byId('mmScopeReports').textContent=message+' This is not an organization-wide report unless all pages were loaded.';
  }
  function merchantCard(r){
    const item=document.createElement('article');item.className='mm-merchant';
    item.append(text('strong',r.business||'Unnamed business'));
    item.append(text('div',[r.city||'Town not provided',r.category||'Category not provided'].join(' · '),'mm-sub'));
    const completed=completedCount(r);
    item.append(text('div',`Checklist: ${completed} of ${TASK_KEYS.length}`,'mm-mini'));
    const track=document.createElement('div');track.className='mm-track';
    const bar=document.createElement('i');bar.style.width=`${Math.round(completed/TASK_KEYS.length*100)}%`;track.append(bar);item.append(track);
    item.append(text('div',r.assignedTo?.email?`Assigned: ${r.assignedTo.email}`:'Unassigned','mm-mini'));
    const age=dateAge(r.createdAt);if(age!==null)item.append(text('div',`Application age: ${age} day${age===1?'':'s'}`,'mm-mini'));
    const btn=text('button','View merchant','secondary');btn.type='button';btn.addEventListener('click',()=>openMerchant(r.id));item.append(btn);
    return item;
  }
  function pipeline(){
    const rows=getRows();const needle=byId('mmRegionSearch').value.trim().toLowerCase();
    const board=byId('mmBoard');board.replaceChildren();
    const filtered=rows.filter(r=>!needle||[r.business,r.city,r.category,r.assignedTo?.email].some(s=>String(s||'').toLowerCase().includes(needle)));
    for(const status of STATUSES){
      const matching=filtered.filter(r=>r.status===status);
      const col=document.createElement('section');col.className='mm-column';
      const title=text('h3',status,'mm-column-title');title.append(text('span',matching.length,'mm-count'));col.append(title);
      if(!matching.length)col.append(text('p','No applications','mm-empty'));
      for(const r of matching)col.append(merchantCard(r));
      board.append(col);
    }
    byId('mmBoardCount').textContent=`${filtered.length} of ${rows.length} loaded applications shown`;
  }
  function bars(target,entries){
    const box=byId(target);box.replaceChildren();const max=Math.max(1,...entries.map(d=>d.count));
    for(const item of entries){
      const row=document.createElement('div');row.className='mm-row';
      const label=text('span',item.label,'mm-label');label.title=item.label;
      const track=document.createElement('div');track.className='mm-bar';const bar=document.createElement('i');
      bar.style.width=`${Math.round(item.count/max*100)}%`;track.append(bar);
      row.append(label,track,text('span',item.count,'mm-v'));box.append(row);
    }
    if(!entries.length)box.append(text('p','No records loaded.','mm-empty'));
  }
  function reporting(){
    const s=stats(getRows());
    byId('mmKpiTotal').textContent=s.total;
    byId('mmKpiAssigned').textContent=s.assigned;
    byId('mmKpiChecklist').textContent=s.fullyChecked;
    byId('mmKpiTasks').textContent=s.checklistTotal?`${Math.round(s.checklistDone/s.checklistTotal*100)}%`:'—';
    bars('mmStatusBars',STATUSES.map(label=>({label,count:s.statusCounts[label]})));
    bars('mmCityBars',s.cities.slice(0,8));
    bars('mmCategoryBars',s.categories.slice(0,8));
    bars('mmAssignmentBars',[{label:'Assigned',count:s.assigned},{label:'Unassigned',count:s.unassigned}]);
    byId('mmExport').disabled=getRole()!=='admin'||!s.total;
    byId('mmExport').title=getRole()!=='admin'?'Only administrators can export.':'Export aggregate counts only; no names or phone numbers.';
  }
  function exportReport(){
    if(getRole()!=='admin')return;
    const s=stats(getRows());if(!s.total)return;
    const csv=csvSummary(s);const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`mpay-pilot-summary-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  byId('mmRegionSearch').addEventListener('input',pipeline);
  byId('mmExport').addEventListener('click',exportReport);
  show('directory');
  function render(){
    caution();
    if(selected()==='pipeline')pipeline();
    if(selected()==='reports')reporting();
  }
  return {render};
}
