// Admin-only review/decision on a single existing merchant onboarding submission.
// Never handles invitation tokens, merchant document uploads or payment activation.
const FIELD_GROUPS=[
  ["Business identity",[["legalName","Registered business name"],["tradeName","Trading name"],["entityType","Business structure"],["sector","Business category"],["description","Products / services"]]],
  ["Representative and location",[["repName","Authorized representative"],["repRole","Representative's role"],["phone","Contact phone"],["email","Business email"],["county","County"],["town","Town"],["location","Trading location"]]],
  ["Payment preferences",[["currentMethod","Current payment method"],["device","Merchant device"],["transactions","Estimated daily transactions"],["ticket","Typical sale amount"],["interest","Interested in"]]],
  ["Declarations",[["consentVersion","Consent text version"],["submittedAt","Date submitted"]]]
];
const FLAG_OPTIONS=[
 ["legalName","Registered business name"],["tradeName","Trading name"],
 ["description","Products / services"],["entityType","Business structure"],
 ["sector","Business category"],["repName","Representative"],["repRole","Representative role"],
 ["phone","Contact phone"],["email","Business email"],["county","County"],
 ["town","Town"],["location","Trading location"],
 ["currentMethod","Current payment method"],["device","Device"],
 ["transactions","Transaction estimate"],["ticket","Typical sale amount"],
 ["interest","Payment preferences"],["declarations","Authority / declarations"]
];
export function formatMerchantSubmission(target,submission){
 target.replaceChildren();
 if(!submission){target.textContent="No onboarding form submitted yet.";return;}
 for(const [heading,fields] of FIELD_GROUPS){
  const section=document.createElement("section");section.className="review-fields-section";
  const h=document.createElement("h5");h.textContent=heading;section.append(h);
  const dl=document.createElement("dl");dl.className="on-submission-grid";
  for(const [key,label] of fields){
   if(!(key in submission))continue;
   const dt=document.createElement("dt");dt.textContent=label;
   const dd=document.createElement("dd");const value=submission[key];
   dd.textContent=Array.isArray(value)?value.join(", "):(value==null||value===""?"—":String(value));
   dl.append(dt,dd);
  }
  if(dl.childElementCount){section.append(dl);target.append(section);}
 }
}
export function initReview({auth,getIdToken,getRole,getSelected}){
 const $=id=>document.getElementById(id);
 let latestRequest=0,version=0,hasSubmission=false,busy=false;
 const feedback=(text,error=false)=>{$("reviewFeedback").textContent=text||"";$('reviewFeedback').style.color=error?"#993f30":"#27644c";};
 async function post(route,body){
  const user=auth.currentUser;if(!user)throw new Error("Sign in required.");
  const token=await getIdToken(user);
  const response=await fetch(`/api/onboarding-review/${route}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body),cache:"no-store",credentials:"same-origin"});
  const result=await response.json().catch(()=>({message:`Unexpected server response: HTTP ${response.status}`}));
  if(!response.ok)throw new Error(result.message||`HTTP ${response.status}`);
  return result;
 }
 function renderFlags(){
  const grid=$("reviewFlags");grid.replaceChildren();
  for(const [key,label] of FLAG_OPTIONS){
   const wrap=document.createElement("label");wrap.className="review-flag";
   const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.value=key;checkbox.name="reviewFlag";
   wrap.append(checkbox,document.createTextNode(label));grid.append(wrap);
  }
 }
 renderFlags();
 function selectedFlags(){return [...$("reviewFlags").querySelectorAll("input:checked")].map(el=>el.value);}
 function disableAsAppropriate(){
  const canEdit=hasSubmission&&getRole()==="admin"&&!busy;
  $("reviewStatus").disabled=!canEdit;$("reviewNote").disabled=!canEdit;
  $("reviewSave").disabled=!canEdit;
  $("reviewFlags").querySelectorAll("input").forEach(e=>e.disabled=!canEdit);
 }
 async function draw(application){
  const requestId=++latestRequest;version=0;hasSubmission=false;
  $("reviewStatus").value="reviewing";$("reviewNote").value="";
  $("reviewFlags").querySelectorAll("input").forEach(e=>e.checked=false);
  $("reviewMeta").textContent="";feedback("Loading administrative review…");disableAsAppropriate();
  try{
   const result=await post("detail",{applicationId:application.id});
   if(requestId!==latestRequest||getSelected()?.id!==application.id)return;
   hasSubmission=Boolean(result.hasSubmission);
   const current=result.review||{};version=current.version||0;
   if(current.status!=="not_started")$("reviewStatus").value=current.status;
   $("reviewNote").value=current.note||"";
   const flags=new Set(current.flags||[]);
   $("reviewFlags").querySelectorAll("input").forEach(el=>el.checked=flags.has(el.value));
   $("reviewMeta").textContent=current.updatedAt?`Last updated: ${new Date(current.updatedAt).toLocaleString("en-KE")} · ${current.updatedBy||"Staff"} · Revision ${version}`:"No review decision recorded.";
   feedback(hasSubmission?"Administrative review only. No payment account is approved or activated.":"Onboarding form has not been submitted yet.");
   disableAsAppropriate();
  }catch(e){if(requestId===latestRequest)feedback(e.message,true);}
 }
 $("reviewSave").addEventListener("click",async()=>{
  const application=getSelected();if(!application||getRole()!=="admin"||!hasSubmission||busy)return;
  const status=$("reviewStatus").value,flags=selectedFlags(),note=$("reviewNote").value.trim();
  if(status==="corrections_needed"&&(!flags.length||note.length<8))return feedback("Select a discrepancy and explain the correction needed (at least 8 characters).",true);
  if(status==="ready_for_partner_review"&&flags.length)return feedback("Resolve all discrepancy flags before marking partner-review readiness.",true);
  if(status==="closed_no_pilot"&&note.length<8)return feedback("Explain why this pilot application was closed.",true);
  busy=true;disableAsAppropriate();feedback("Saving administrative decision…");
  try{
   const result=await post("save",{applicationId:application.id,expectedVersion:version,status,flags,note});
   if(getSelected()?.id!==application.id)return;
   version=result.review.version;
   $("reviewMeta").textContent=`Saved by ${result.review.updatedBy||"Staff"} · Revision ${version}`;
   feedback("Review saved and audited. Correction flags are internal only; no merchant message was sent.");
  }catch(e){feedback(e.message+" Refresh the review if another staff member changed it.",true);}
  finally{busy=false;disableAsAppropriate();}
 });
 $("reviewRefresh").addEventListener("click",()=>{const application=getSelected();if(application)draw(application);});
 return {draw,clear(){latestRequest++;version=0;hasSubmission=false;feedback("");$("reviewMeta").textContent="";disableAsAppropriate();}};
}
