import {REVIEW_STATES,REVIEW_LABELS,kenyaToday,operationsSummary,orderedQueue} from './operations-core.mjs';
export function initOperations({getRows,getRole,getSelected,request,refreshDetail,openMerchant}){
  const $=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
  const isAdmin=()=>getRole()==='admin';
  const say=(text,error=false)=>{const m=$('opFeedback');m.textContent=text||'';m.className=error?'feedback error':'feedback';m.hidden=!text;};
  let busy=false;
  async function update(subpath,method,payload,label){
    const r=getSelected();if(!r?.id||!isAdmin()||busy)return;
    busy=true;say(`${label}…`);
    try{
      await request(`/pilot-applications/${encodeURIComponent(r.id)}/${subpath}`,{method,body:JSON.stringify(payload)});
      await refreshDetail();say(`${label} saved.`);
    }catch(e){say(e.message,true);}finally{busy=false;}
  }
  $('opSaveFollowUp').addEventListener('click',()=>update('follow-up','PATCH',{
    dueDate:$('opDueDate').value,purpose:$('opPurpose').value
  },'Follow-up'));
  $('opCompleteFollowUp').addEventListener('click',()=>update('follow-up/complete','POST',{},'Follow-up completion'));
  $('opSaveReview').addEventListener('click',()=>update('verification','PATCH',{
    state:$('opReviewState').value
  },'Business review'));
  $('opSearch').addEventListener('input',render);
  $('opDueDate').min=kenyaToday();
  function drawDetail(r){
    const f=r.followUp||null;
    $('opDueDate').value=f?.dueDate||'';
    $('opPurpose').value=f?.purpose||'';
    $('opReviewState').value=REVIEW_STATES.includes(r.verification?.state)?r.verification.state:'not_started';
    $('opFollowUpStatus').textContent=f?`${f.state==='completed'?'Completed':'Open'} · ${f.dueDate} · ${f.purpose}`:'No follow-up scheduled';
    for(const name of ['opDueDate','opPurpose','opReviewState','opSaveFollowUp','opSaveReview'])$(name).disabled=!isAdmin();
    $('opCompleteFollowUp').disabled=!isAdmin()||f?.state!=='open';
  }
  function render(){
    const today=kenyaToday(),s=operationsSummary(getRows(),today);
    for(const [id,value] of [['opOverdue',s.categories.overdue],['opToday',s.categories.today],['opUpcoming',s.categories.upcoming],['opNeedsReview',s.reviews.not_started+s.reviews.documents_requested+s.reviews.needs_clarification]])
      $(id).textContent=value;
    $('opScope').textContent=`${s.total} loaded applications only · All due dates use Kenya time (EAT). No automatic reminders are sent.`;
    const tbody=$('opQueue');tbody.replaceChildren();
    const ordered=orderedQueue(getRows(),today,$('opSearch').value);
    for(const {record:r,category} of ordered){
      const tr=el('tr');
      for(const value of [r.business||'Unnamed business',r.assignedTo?.email||'Unassigned',r.followUp?.dueDate||'—',category,REVIEW_LABELS[r.verification?.state]||'Not started'])
        tr.append(el('td',value));
      const cell=el('td'),btn=el('button','View / manage','secondary btn-small');btn.type='button';btn.addEventListener('click',()=>openMerchant(r.id));cell.append(btn);tr.append(cell);tbody.append(tr);
    }
    if(!ordered.length){const tr=el('tr'),td=el('td','No matching applications loaded.','empty');td.colSpan=6;tr.append(td);tbody.append(tr);}
    const workload=$('opWorkload');workload.replaceChildren();
    for(const item of s.staff){const line=el('div',undefined,'op-workload-item');line.append(el('span',item.email),el('strong',`${item.total} merchants · ${item.needsAttention} due/overdue`));workload.append(line);}
  }
  return {drawDetail,render};
}
