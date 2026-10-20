import {initInsights} from "./insights.js";
import {initOperations} from "./operations.js";
import {initInvitations} from "./invitations.js";
import {initReview} from "./review.js";
import {initCorrections} from "./corrections.js";
import {initReadiness} from "./readiness.js";
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,signOut,setPersistence,inMemoryPersistence,onAuthStateChanged,getIdToken} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
const cfg=window.MPAY_FIREBASE_CONFIG;
const $=id=>document.getElementById(id);
const app=initializeApp(cfg),auth=getAuth(app);
const STATUSES=["new","contacted","screening","waitlisted","declined"];
let rows=[],cursor=null,role=null,selected=null,pending=false,lastFocus=null;
const insights=initInsights({getRows:()=>rows,getRole:()=>role,openMerchant:id=>openDetail(id),getCursor:()=>cursor});
const adminRole=()=>role==="admin";
function message(where,text,error=false){const el=$(where);el.textContent=text||"";el.className=text?"feedback"+(error?" error":""):"hidden";}
function el(tag,content,cls){const x=document.createElement(tag);if(content!==undefined)x.textContent=content;if(cls)x.className=cls;return x;}
function dateStr(date){return date?new Date(date).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—";}
async function request(path,opts={}){
  const user=auth.currentUser;if(!user)throw new Error("Sign in required.");
  const token=await getIdToken(user);
  const response=await fetch("/api/admin"+path,{...opts,headers:{Authorization:`Bearer ${token}`,...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})},cache:"no-store"});
  const data=await response.json().catch(()=>({message:"Unexpected server response."}));
  if(!response.ok)throw new Error(data.message||`Request failed (HTTP ${response.status}).`);
  return data;
}
const operations=initOperations({getRows:()=>rows,getRole:()=>role,getSelected:()=>selected,
  request,refreshDetail,openMerchant:id=>openDetail(id)});
const invitations=initInvitations({auth,getIdToken,getRole:()=>role,getSelected:()=>selected});
const review=initReview({auth,getIdToken,getRole:()=>role,getSelected:()=>selected});
const corrections=initCorrections({auth,getIdToken,getRole:()=>role,getSelected:()=>selected});
const readiness=initReadiness({auth,getIdToken,getRole:()=>role,getSelected:()=>selected});
function filterItems(){
  const term=$("search").value.trim().toLowerCase(),status=$("statusFilter").value,assigned=$("assignmentFilter").value;
  return rows.filter(r=>[r.fullName,r.business,r.phone,r.city,r.category,r.assignedTo?.email].some(v=>String(v||"").toLowerCase().includes(term)) && (!status||r.status===status) && (!assigned||(assigned==="yes"?!!r.assignedTo:!r.assignedTo)));
}
function render(){
  const tbody=$("rows");tbody.replaceChildren();const visible=filterItems();
  for(const r of visible){
    const tr=el("tr");const td=(content)=>{const t=el("td",content);tr.append(t);return t;};
    td(r.createdAt?new Date(r.createdAt).toLocaleDateString("en-KE"):"—");
    const merchant=td();merchant.append(el("b",r.business));merchant.append(el("div",r.fullName,"tiny muted"));
    td(r.phone);td(r.city);
    const state=td();state.append(el("span",r.status,"status "+r.status));
    td(r.assignedTo?.email||"Unassigned");
    const cell=td(),button=el("button","View / manage","secondary btn-small");button.type="button";
    button.addEventListener("click",()=>openDetail(r.id));cell.append(button);tbody.append(tr);
  }
  if(!visible.length){const tr=el("tr"),td=el("td","No applications match the current filters.","empty");td.colSpan=7;tr.append(td);tbody.append(tr);}
  $("total").textContent=rows.length;$("new").textContent=rows.filter(x=>x.status==="new").length;
  $("progress").textContent=rows.filter(x=>["contacted","screening"].includes(x.status)).length;
  $("assigned").textContent=rows.filter(x=>x.assignedTo).length;
  insights.render();operations.render();$("more").disabled=!cursor||pending;$("roleLabel").textContent=role==="admin"?"Administrator":"Reviewer · read only";
}
async function load(reset=false){
  if(pending)return;pending=true;$("more").disabled=true;
  try{
    const result=await request("/pilot-applications"+(reset||!cursor?"":`?cursor=${encodeURIComponent(cursor)}`));
    if(reset)rows=[];
    const existing=new Set(rows.map(x=>x.id));rows.push(...result.items.filter(x=>!existing.has(x.id)));
    cursor=result.nextCursor;role=result.role;render();
  }finally{pending=false;$("more").disabled=!cursor;}
}
function profileCell(parent,label,value){const div=el("div");div.append(el("span",label,"label"));div.append(el("span",value??"—","value"));parent.append(div);}
function readonly(){
  for(const id of ["detailStatus","assigneeEmail","saveStatus","saveAssignee","clearAssignee","noteText","addNote"]){$(id).disabled=!adminRole();}
}
function drawDetail(data){
  const r=data.application;selected=r;$("drawerTitle").textContent=r.business||"Merchant application";
  $("drawerStatus").textContent=r.status;$("drawerStatus").className="status "+r.status;
  const profile=$("profileFields");profile.replaceChildren();
  for(const [name,value] of [["Applicant",r.fullName],["Business",r.business],["Phone",r.phone],["Town / market",r.city],["Business type",r.category],["Current payment method",r.payments],["Submitted",dateStr(r.createdAt)],["Last updated",dateStr(r.updatedAt)]])profileCell(profile,name,value);
  $("detailStatus").value=r.status;$("assigneeEmail").value=r.assignedTo?.email||"";
  const checklist=$("checklist");checklist.replaceChildren();
  for(const item of data.checklist){
    const label=el("label",undefined,"checkline"),box=el("input");box.type="checkbox";box.checked=r.onboarding?.[item.key]?.completed===true;box.disabled=!adminRole();
    box.addEventListener("change",async()=>{
      const desired=box.checked;box.disabled=true;
      try{await request(`/pilot-applications/${encodeURIComponent(r.id)}/checklist`,{method:"PATCH",body:JSON.stringify({key:item.key,completed:desired})});
        await refreshDetail();message("detailMessage","Checklist updated.");
      }catch(e){box.checked=!desired;message("detailMessage",e.message,true);}finally{box.disabled=!adminRole();}
    });label.append(box,el("span",item.label));checklist.append(label);
  }
  const notes=$("notes");notes.replaceChildren();
  if(!data.notes.length)notes.append(el("p","No internal notes yet.","muted tiny"));
  for(const n of data.notes){const item=el("div",undefined,"note");item.append(el("div",n.text));item.append(el("div",`${n.author} · ${dateStr(n.at)}`,"tiny muted"));notes.append(item);}
  const list=$("history");list.replaceChildren();
  if(!data.history.length)list.append(el("li","No activity recorded yet."));
  for(const item of data.history){
    let action=item.action;
    if(item.action==="status")action=`Status: ${item.from||"—"} → ${item.to||"—"}`;
    else if(item.action==="assignment")action=`Assignment: ${item.from||"Unassigned"} → ${item.to||"Unassigned"}`;
    else if(item.action==="checklist")action=`Onboarding ${item.key||"task"}: ${item.to==="true"?"completed":"reopened"}`;
    else if(item.action==="note")action="Internal note added";
    else if(item.action==="followup_scheduled")action=`Follow-up scheduled: ${item.to||"—"}`;
    else if(item.action==="followup_completed")action="Follow-up marked completed";
    else if(item.action==="verification_review")action=`Business review: ${item.from||"—"} → ${item.to||"—"}`;
    list.append(el("li",`${action} · ${item.actor} · ${dateStr(item.at)}`));
  }
  readonly();operations.drawDetail(r);invitations.draw(r);review.draw(r);corrections.draw(r);readiness.draw(r);
}
async function refreshDetail(){
  if(!selected)return;const currentId=selected.id;
  const result=await request(`/pilot-applications/${encodeURIComponent(currentId)}`);
  if(!selected||selected.id!==currentId)return;
  drawDetail(result);
  const i=rows.findIndex(x=>x.id===currentId);if(i>=0)rows[i]=result.application;
  render();
}
async function openDetail(id){
  lastFocus=document.activeElement;message("detailMessage","Loading merchant profile…");
  $("overlay").classList.remove("hidden");$("closeDrawer").focus();
  selected={id};
  try{await refreshDetail();message("detailMessage","");}catch(e){message("detailMessage",e.message,true);}
}
function closeDetail(){$("overlay").classList.add("hidden");selected=null;invitations.clear();review.clear();corrections.clear();readiness.clear();message("detailMessage","");lastFocus?.focus?.();}
async function mutate(endpoint,method,payload,label){
  if(!selected||!adminRole())return;
  message("detailMessage",label+"…");
  try{await request(`/pilot-applications/${encodeURIComponent(selected.id)}/${endpoint}`,{method,body:JSON.stringify(payload)});
    await refreshDetail();message("detailMessage",label+" saved.");
  }catch(e){message("detailMessage",e.message,true);}
}
$("signin").addEventListener("submit",async event=>{
  event.preventDefault();const button=$("signin").querySelector("button");button.disabled=true;
  message("loginMessage","Signing in…");
  try{await setPersistence(auth,inMemoryPersistence);
    await signInWithEmailAndPassword(auth,$("email").value,$("password").value);
    $("password").value="";message("loginMessage","");
  }catch(e){message("loginMessage",`Sign-in failed: ${e.code||"unknown error"}.`,true);}finally{button.disabled=false;}
});
$("logout").addEventListener("click",async()=>{closeDetail();await signOut(auth);location.reload();});
$("refresh").onclick=async()=>{try{await load(true);message("message","Applications refreshed.");}catch(e){message("message",e.message,true);}};
$("more").onclick=async()=>{try{await load();}catch(e){message("message",e.message,true);}};
for(const id of ["search","statusFilter","assignmentFilter"]){$(id).addEventListener(id==="search"?"input":"change",render);}
$("clearFilters").onclick=()=>{$("search").value="";$("statusFilter").value="";$("assignmentFilter").value="";render();};
$("closeDrawer").onclick=closeDetail;
$("overlay").addEventListener("click",e=>{if(e.target===$("overlay"))closeDetail();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("overlay").classList.contains("hidden"))closeDetail();});
$("saveStatus").onclick=()=>mutate("status","PATCH",{status:$("detailStatus").value},"Status");
$("saveAssignee").onclick=()=>mutate("assignment","PATCH",{assigneeEmail:$("assigneeEmail").value},"Assignment");
$("clearAssignee").onclick=()=>mutate("assignment","PATCH",{assigneeEmail:""},"Assignment");
$("addNote").onclick=async()=>{
  const text=$("noteText").value.trim();if(text.length<3){message("detailMessage","Enter a note of at least 3 characters.",true);return;}
  if(!selected||!adminRole())return;
  message("detailMessage","Saving note…");
  try{await request(`/pilot-applications/${encodeURIComponent(selected.id)}/notes`,{method:"POST",body:JSON.stringify({text})});
    $("noteText").value="";await refreshDetail();message("detailMessage","Note saved.");
  }catch(e){message("detailMessage",e.message,true);}
};
onAuthStateChanged(auth,async user=>{
  if(!user){$("login").classList.remove("hidden");$("dashboard").classList.add("hidden");$("logout").classList.add("hidden");$("identity").textContent="";return;}
  $("login").classList.add("hidden");$("dashboard").classList.remove("hidden");$("logout").classList.remove("hidden");$("identity").textContent=user.email||"Staff";
  message("message","Signed in. Loading applications…");
  try{await load(true);message("message","");}
  catch(e){message("message","Signed in, but applications couldn't load: "+e.message,true);}
});
