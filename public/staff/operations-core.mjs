// Pure, testable Phase 4 scheduling and business-review computations.
// YYYY-MM-DD values refer to the Africa/Nairobi calendar day, not browser local time.
export const REVIEW_STATES = [
  'not_started','documents_requested','under_review','reviewed','needs_clarification'
];
export const REVIEW_LABELS = {
  not_started:'Not started',documents_requested:'Documents requested',
  under_review:'Under review',reviewed:'Reviewed (not approved)',
  needs_clarification:'Needs clarification'
};
export function kenyaToday(date=new Date()){
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(date);
  const v=k=>p.find(x=>x.type===k).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
export function followUpCategory(record,today=kenyaToday()){
  const f=record?.followUp;
  if(!f?.dueDate)return 'unscheduled';
  if(f.state==='completed')return 'completed';
  if(f.dueDate<today)return 'overdue';
  if(f.dueDate===today)return 'today';
  return 'upcoming';
}
export function operationsSummary(rows,today=kenyaToday()){
  const categories={overdue:0,today:0,upcoming:0,unscheduled:0,completed:0};
  const reviews=Object.fromEntries(REVIEW_STATES.map(s=>[s,0]));
  const staff=new Map();
  for(const r of rows){
    const category=followUpCategory(r,today);categories[category]++;
    const review=r.verification?.state||'not_started';
    if(Object.hasOwn(reviews,review))reviews[review]++;
    const assignee=r.assignedTo?.email||'Unassigned';
    if(!staff.has(assignee))staff.set(assignee,{email:assignee,total:0,needsAttention:0});
    const item=staff.get(assignee);item.total++;
    if(category==='overdue'||category==='today')item.needsAttention++;
  }
  return {total:rows.length,categories,reviews,staff:[...staff.values()].sort((a,b)=>b.needsAttention-a.needsAttention||a.email.localeCompare(b.email))};
}
export function orderedQueue(rows,today=kenyaToday(),term=''){
  const priority={overdue:0,today:1,upcoming:2,unscheduled:3,completed:4};
  const q=String(term).trim().toLowerCase();
  return rows.filter(r=>!q||[r.business,r.city,r.category,r.assignedTo?.email].some(x=>String(x||'').toLowerCase().includes(q)))
    .map(r=>({record:r,category:followUpCategory(r,today)}))
    .sort((a,b)=>priority[a.category]-priority[b.category]||(a.record.followUp?.dueDate||'').localeCompare(b.record.followUp?.dueDate||'')||(a.record.business||'').localeCompare(b.record.business||''));
}
