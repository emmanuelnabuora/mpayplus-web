// Invite-only merchant onboarding form. Token held in memory, never localStorage or console.
(()=>{"use strict";
const form=document.getElementById("onboarding"),panels=[...document.querySelectorAll(".step")];
const links=[...document.querySelectorAll(".step-link")],progress=document.getElementById("progress");
const badge=document.getElementById("stepLabel"),back=document.getElementById("back"),next=document.getElementById("next");
const error=document.getElementById("error"),notice=document.getElementById("invitationNotice");
const names={legalName:"Registered name",tradeName:"Trading name",entityType:"Business type",sector:"Category",description:"Products / services",repName:"Representative",repRole:"Role",phone:"Contact phone",email:"Business email",county:"County",town:"Town",location:"Trading location",currentMethod:"Current payment method",device:"Merchant device",transactions:"Daily transactions",ticket:"Typical transaction"};
const hash=new URLSearchParams(location.hash.replace(/^#/,""));
const invite=hash.get("invite")||"";
// Remove sensitive fragment without reloading. Staff must resend invite if user closes the tab.
if(location.hash)history.replaceState(null,"",location.pathname);
let at=0,widget=null,ready=false,submitting=false;
const fail=(message)=>{error.textContent=message;error.classList.add("show");};
function show(){
  panels.forEach((el,i)=>{el.classList.toggle("active",i===at);el.hidden=i!==at;});
  links.forEach((el,i)=>el.classList.toggle("active",i===at));
  badge.textContent=`STEP ${at+1} OF 5`;progress.style.width=`${(at+1)*20}%`;
  back.disabled=at===0;next.textContent=at===4?"Submit for review":"Continue →";
  error.classList.remove("show");
  if(at===4)renderTurnstile();
  window.scrollTo({top:165,behavior:"smooth"});
}
function stepValid(index){
  for(const x of panels[index].querySelectorAll("input[required],select[required],textarea[required]")){
    if(!x.checkValidity()){x.focus();fail("Please complete the required fields before continuing.");return false;}
  }
  return true;
}
function collect(){
  const d={};for(const k of Object.keys(names))d[k]=form.elements[k]?.value||"";
  d.interest=[...form.querySelectorAll('input[name="interest"]:checked')].map(x=>x.value);
  for(const k of ["declarationAuthority","declarationContact","declarationPilot"])d[k]=form.elements[k].checked;
  d.consentVersion="pilot-onboarding-2026-10-15";
  return d;
}
function review(){
  const out=document.getElementById("summary");out.replaceChildren();const values=collect();
  for(const [key,label] of Object.entries(names)){
    const box=document.createElement("div");box.className="summary-row";
    const a=document.createElement("div");a.className="summary-label";a.textContent=label;
    const b=document.createElement("div");b.className="summary-val";b.textContent=values[key]||"—";
    box.append(a,b);out.append(box);
  }
  const box=document.createElement("div");box.className="summary-row";
  const a=document.createElement("div");a.className="summary-label";a.textContent="Preferred methods";
  const b=document.createElement("div");b.className="summary-val";b.textContent=values.interest.join(", ")||"None";
  box.append(a,b);out.append(box);
}
function renderTurnstile(){
  if(widget!==null||!window.turnstile?.render)return;
  try{widget=window.turnstile.render("#onboardCaptcha",{sitekey:document.getElementById("onboardCaptcha").dataset.sitekey,theme:"light"});}
  catch{fail("The security check couldn't load. Please reload your original invitation link.");}
}
async function post(route,data){
  const r=await fetch("/api/merchant-onboarding/"+route,{method:"POST",cache:"no-store",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const result=await r.json().catch(()=>({message:"Unexpected server response."}));
  if(!r.ok)throw new Error(result.message||`Request failed (HTTP ${r.status}).`);
  return result;
}
async function validateInvite(){
  if(!/^[0-9a-f]{64}$/.test(invite)){notice.textContent="No valid invitation was supplied. Request a new onboarding link from the M-Pay+ pilot team.";return;}
  try{
    const r=await post("validate",{invite});
    ready=true;notice.textContent=`Invitation verified for ${r.business}. Expires ${new Date(r.expiresAt).toLocaleString("en-KE")}. Use test information only until identity and privacy controls have been approved.`;
    next.disabled=false;
  }catch(e){notice.textContent=e.message;}
}
back.addEventListener("click",()=>{if(at){at--;show();}});
next.addEventListener("click",async()=>{
  if(!ready||submitting)return;
  if(at<4){if(!stepValid(at))return;at++;if(at===4)review();show();return;}
  for(let i=0;i<4;i++)if(!stepValid(i)){at=i;show();fail("Please complete every required step.");return;}
  renderTurnstile();const token=widget!==null?window.turnstile?.getResponse(widget):"";
  if(!token){fail("Complete the security check first. If it's still loading, try again shortly.");return;}
  submitting=true;next.disabled=true;next.textContent="Submitting…";
  try{
    const response=await post("submit",{invite,fields:collect(),turnstileToken:token});
    const success=document.getElementById("success");
    success.textContent="✓ Application submitted successfully. " + (response.message || "Your onboarding information was received for review.");
    success.style.display="block";
    success.setAttribute("aria-live","polite");
    // Preserve the successful final state and block duplicate submissions.
    form.querySelectorAll("input,select,textarea").forEach(x=>x.disabled=true);
    back.disabled=true;
    back.style.display="none";
    next.disabled=true;
    next.textContent="✓ Application submitted";
    next.style.opacity="1";
    next.style.cursor="default";
    notice.textContent="Form received for administrative review. Payment processing remains disabled.";
    success.scrollIntoView({behavior:"smooth",block:"center"});
  }catch(e){fail(e.message);window.turnstile?.reset(widget);next.disabled=false;next.textContent="Submit for review";}
  finally{submitting=false;}
});
next.disabled=true;show();validateInvite();
})();
