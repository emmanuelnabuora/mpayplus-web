// M-Pay+ Phase 3: pure, non-network business statistics for already-loaded pilot applications.
// No changes to Firestore or payment approval semantics.
export const STATUSES = Object.freeze(["new", "contacted", "screening", "waitlisted", "declined"]);
export const TASK_KEYS = Object.freeze([
  "initial_contact", "business_review", "pilot_briefing", "terms_acknowledgement", "demo_walkthrough", "readiness_review"
]);
export function completedCount(application){
  return TASK_KEYS.reduce((n,key)=>n+(application?.onboarding?.[key]?.completed===true?1:0),0);
}
export function stats(applications){
  const rows=Array.isArray(applications)?applications:[];
  const statusCounts=Object.fromEntries(STATUSES.map(s=>[s,0]));
  const categoryCounts=new Map(),cityCounts=new Map();
  let assigned=0,fullyChecked=0,checklistDone=0;
  for(const r of rows){
    if(Object.hasOwn(statusCounts,r.status))statusCounts[r.status]++;
    const category=String(r.category||"Not provided").trim()||"Not provided";
    const city=String(r.city||"Not provided").trim()||"Not provided";
    categoryCounts.set(category,(categoryCounts.get(category)||0)+1);
    cityCounts.set(city,(cityCounts.get(city)||0)+1);
    if(r.assignedTo?.uid)assigned++;
    const count=completedCount(r);checklistDone+=count;
    if(count===TASK_KEYS.length)fullyChecked++;
  }
  const sortCounts=map=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([label,count])=>({label,count}));
  return {
    total:rows.length,statusCounts,assigned,unassigned:rows.length-assigned,
    fullyChecked,awaitingChecklist:rows.length-fullyChecked,
    checklistDone,checklistTotal:rows.length*TASK_KEYS.length,
    categories:sortCounts(categoryCounts),cities:sortCounts(cityCounts)
  };
}
export function dateAge(iso,now=Date.now()){
  if(!iso)return null;
  const t=Date.parse(iso);
  return Number.isFinite(t)?Math.max(0,Math.floor((now-t)/86400000)):null;
}
// Prevent Excel formula interpretation when exported values originate from user-submitted fields.
export function csvCell(value){
  let text=String(value??"").replace(/[\r\n\t\x00-\x1f]+/g," ").trim();
  if(/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function csvSummary(summary){
  const lines=[["Group","Value","Count"],["Total","All loaded",summary.total],
    ...STATUSES.map(s=>["Status",s,summary.statusCounts[s]]),
    ["Assignment","Assigned",summary.assigned],["Assignment","Unassigned",summary.unassigned],
    ["Onboarding","All six checklist items completed",summary.fullyChecked],
    ...summary.categories.map(x=>["Business type",x.label,x.count]),
    ...summary.cities.map(x=>["Town / market",x.label,x.count])];
  return "\uFEFF"+lines.map(x=>x.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
