// Phase 7: staff-initiated, test-only merchant correction requests.
// Never logs or persists bearer links. No merchant payment activation.
const LABELS={legalName:"Registered business name",tradeName:"Trading name",description:"Products / services",
entityType:"Business structure",sector:"Business category",repName:"Authorized representative",repRole:"Representative role",
phone:"Contact phone",email:"Business email",county:"County",town:"Town",location:"Trading location",
currentMethod:"Current payment method",device:"Merchant device",transactions:"Daily transaction estimate",
ticket:"Typical sale amount",interest:"Preferred payment methods"};
export function initCorrections({auth,getIdToken,getRole,getSelected}){
 const $=id=>document.getElementById(id);
 let generation=0,currentVersion=0,currentState="not_requested",busy=false;
 const feedback=(message,bad=false)=>{const node=$("correctionFeedback");node.textContent=message||"";node.style.color=bad?"#963a2e":"#27644c";};
 async function post(route,data){
  const user=auth.currentUser;if(!user)throw Error("Sign in first.");
  const token=await getIdToken(user);
  const response=await fetch(`/api/merchant-corrections/admin/${route}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(data),credentials:"same-origin",cache:"no-store"});
  const result=await response.json().catch(()=>({message:`Unexpected HTTP ${response.status}`}));
  if(!response.ok)throw Error(result.message||`HTTP ${response.status}`);return result;
 }
 function linkClear(){$("correctionOnce").hidden=true;$("correctionLink").value="";}
 function present(result){
  currentState=result.state;
  const request=result.request;
  $("correctionState").textContent=request?`${result.state.replaceAll("_"," ")} · Review revision ${request.reviewVersion}`:"Not requested";
  $("correctionFields").textContent=request?request.fields.map(f=>LABELS[f]||f).join(", "):"—";
  $("correctionExpiry").textContent=request?.expiresAt?new Date(request.expiresAt).toLocaleString("en-KE"):"—";
  const target=$("correctionReceived");target.replaceChildren();
  if(result.submission){for(const [key,value] of Object.entries(result.submission)){
   const row=document.createElement("div");row.className="correction-item";
   const label=document.createElement("strong");label.textContent=LABELS[key]||key;
   const content=document.createElement("span");content.textContent=Array.isArray(value)?value.join(", "):String(value);
   row.append(label,content);target.append(row);
  }}else target.textContent="No corrections received yet.";
 }
 async function draw(r){
  const index=++generation;linkClear();feedback("Loading correction status…");currentVersion=0;currentState="not_requested";
  $("correctionIssue").disabled=true;
  try{
   const [detail,review]=await Promise.all([
    post("detail",{applicationId:r.id}),
    (async()=>{const u=auth.currentUser,t=await getIdToken(u);const v=await fetch("/api/onboarding-review/detail",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${t}`},body:JSON.stringify({applicationId:r.id}),cache:"no-store"});if(!v.ok)throw Error("Could not check current review.");return v.json();})()
   ]);
   if(index!==generation||getSelected()?.id!==r.id)return;
   present(detail);
   const latest=review.review||{};currentVersion=latest.version||0;
   const flags=latest.flags||[],eligible=latest.status==="corrections_needed"&&flags.length>0&&!flags.includes("declarations");
   $("correctionIssue").disabled=getRole()!=="admin"||!eligible||(detail.state==="submitted"&&detail.request?.reviewVersion===currentVersion);
   feedback(!eligible?"Save a 'Corrections needed' review with editable flagged fields first. Declarations require separate verified handling.":detail.state==="submitted"&&detail.request?.reviewVersion===currentVersion?"Corrections received. Review them and save a new review decision before issuing another request.":"Request a private 72-hour link; only flagged fields will be editable.");
  }catch(e){if(index===generation)feedback(e.message,true);}
 }
 $("correctionIssue").addEventListener("click",async()=>{
  const r=getSelected();if(!r||getRole()!=="admin"||busy)return;
  linkClear();busy=true;$("correctionIssue").disabled=true;feedback("Issuing a single-use correction link…");
  try{
   const response=await post("issue",{applicationId:r.id,expectedReviewVersion:currentVersion});
   if(getSelected()?.id!==r.id)return;
   $("correctionLink").value=response.url;$("correctionOnce").hidden=false;
   $("correctionState").textContent="issued";$("correctionExpiry").textContent=new Date(response.expiresAt).toLocaleString("en-KE");
   feedback("Link generated. Copy it once and share privately with the intended test merchant. Reissuing invalidates the previous link.");
  }catch(e){feedback(e.message,true);}
  finally{busy=false;$("correctionIssue").disabled=currentState==="submitted";}
 });
 $("correctionCopy").addEventListener("click",async()=>{
  const f=$("correctionLink");if(!f.value)return;
  try{await navigator.clipboard.writeText(f.value);feedback("Private link copied.");}
  catch{f.focus();f.select();feedback("Use Cmd+C to copy the link manually.",true);}
 });
 $("correctionRefresh").addEventListener("click",()=>{const r=getSelected();if(r)draw(r);});
 return {draw,clear(){generation++;linkClear();$("correctionReceived").replaceChildren();feedback("");}};
}
