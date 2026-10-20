// M-Pay+ Phase 8: controlled review of submitted merchant corrections.
// Only a staff identity token can access endpoints. All values rendered as text.
const LABELS={legalName:"Registered business name",tradeName:"Trading name",description:"Products / services",entityType:"Business structure",sector:"Business category",repName:"Authorized representative",repRole:"Representative's role",phone:"Contact phone",email:"Business email",county:"County",town:"Town",location:"Trading location",currentMethod:"Existing payment method",device:"Merchant device",transactions:"Daily transaction estimate",ticket:"Typical sale amount",interest:"Payment methods requested"};
function asText(v){return Array.isArray(v)?v.join(", "):v==null?"—":String(v);}
export function makeComparison(container,fields,original,corrected){
 container.replaceChildren();
 if(!fields.length){container.textContent="No correction fields to compare.";return;}
 for(const field of fields){
  const row=document.createElement("div");row.className="readiness-compare-row";
  const label=document.createElement("strong");label.textContent=LABELS[field]||field;row.append(label);
  for(const [tag,values] of [["Originally submitted",original],["Merchant correction",corrected]]){
   const cell=document.createElement("div");const small=document.createElement("span");small.textContent=tag;
   const val=document.createElement("p");val.textContent=Object.hasOwn(values||{},field)?asText(values[field]):"—";
   cell.append(small,val);row.append(cell);
  }
  container.append(row);
 }
}
export function initReadiness({auth,getIdToken,getRole,getSelected}){
 const $=id=>document.getElementById(id);
 let seq=0,active=null,busy=false;
 const feedback=(message,isError=false)=>{const box=$("readyFeedback");box.textContent=message||"";box.style.color=isError?"#973f34":"#23684e";};
 async function request(route,body){
  const user=auth.currentUser;if(!user)throw Error("Sign in required.");
  const jwt=await getIdToken(user);
  const res=await fetch(`/api/merchant-readiness/admin/${route}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt}`},cache:"no-store",credentials:"same-origin",body:JSON.stringify(body)});
  const json=await res.json().catch(()=>({message:`Unexpected HTTP ${res.status}`}));
  if(!res.ok)throw Error(json.message||`HTTP ${res.status}`);
  return json;
 }
 function state(result){
  $("readyState").textContent=result.readiness.state==="administratively_ready_for_partner_review"?"Administratively ready for partner review":"Action required";
  $("readyProgress").textContent=`${result.readiness.checklistCompleted} / ${result.readiness.checklistTotal} checklist items complete`;
  const blockers=$("readyBlockers");blockers.replaceChildren();
  if(result.readiness.blockers.length===0){const item=document.createElement("li");item.textContent="No internal readiness blockers currently identified. Licensed partner verification still required.";blockers.append(item);}
  for(const b of result.readiness.blockers){const li=document.createElement("li");li.textContent=b;blockers.append(li);}
  const decision=result.decision;
  $("readyCorrectionState").textContent=result.request.status==="not_requested"?"No correction requested":result.request.status;
  $("readyDecisionStatus").textContent=decision?`${decision.state} · ${decision.reviewedBy||"Staff"}`:"No correction decision recorded";
  $("readyPreviousNote").textContent=decision?.note||"";
  makeComparison($("readyComparison"),result.request.fields,result.original,result.corrected);
  $("readyDecisionNote").value="";
  const canDecide=getRole()==="admin"&&result.request.status==="submitted"&&!decision&&
   result.review.status==="corrections_needed"&&result.review.version===result.request.reviewVersion;
  $("readyAccept").disabled=!canDecide||busy;$("readyReject").disabled=!canDecide||busy;
  $("readyDecisionNote").disabled=!canDecide||busy;
  $("readyNextStep").textContent=decision?.state==="accepted"?
   "Correction accepted for administrative review. Clear resolved flags in the separate Phase 6 review, then update screening/checklist. This does not merge or verify merchant details.":
   decision?.state==="rejected"?
   "Correction rejected. Record a new Corrections needed review revision before reissuing a link.":
   canDecide?"Compare both values, then accept or reject this amendment. Acceptance never activates payments.":
   "Await a submitted correction, or refresh after saving the Phase 6 review.";
 }
 async function draw(application){
  const version=++seq;active=null;feedback("Loading amendment and readiness assessment…");
  $("readyAccept").disabled=true;$("readyReject").disabled=true;
  try{const info=await request("detail",{applicationId:application.id});
   if(version!==seq||getSelected()?.id!==application.id)return;
   active={applicationId:application.id,result:info};state(info);feedback("Administrative readiness is not partner verification or payment approval.");
  }catch(e){if(version===seq)feedback(e.message,true);}
 }
 async function decide(decision){
  if(busy||!active||getRole()!=="admin")return;
  const {applicationId,result}=active,note=$("readyDecisionNote").value.trim();
  if(decision==="rejected"&&note.length<8){feedback("Explain why the correction is rejected (at least eight characters).",true);return;}
  busy=true;$("readyAccept").disabled=true;$("readyReject").disabled=true;feedback("Saving correction decision…");
  try{await request("decision",{applicationId,requestId:result.requestId,expectedReviewVersion:result.request.reviewVersion,state:decision,note});
   if(getSelected()?.id===applicationId){await draw({id:applicationId});feedback(`Correction ${decision}. No merchant payment services activated.`);}
  }catch(e){busy=false;if(getSelected()?.id===applicationId)await draw({id:applicationId});feedback(e.message,true);}
  finally{busy=false;}
 }
 $("readyRefresh").addEventListener("click",()=>{const r=getSelected();if(r)draw(r);});
 $("readyAccept").addEventListener("click",()=>decide("accepted"));
 $("readyReject").addEventListener("click",()=>decide("rejected"));
 return {draw,clear(){seq++;active=null;$("readyComparison").replaceChildren();$("readyBlockers").replaceChildren();feedback("");}};
}
