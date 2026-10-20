(()=>{"use strict";
 const $=id=>document.getElementById(id);
 const raw=new URLSearchParams(location.hash.replace(/^#/,""));
 const token=raw.get("token")||"";
 if(location.hash)history.replaceState(null,"",location.pathname);
 const KEYS={legalName:"Registered business name",tradeName:"Trading name",description:"Products / services",entityType:"Business structure",sector:"Business category",repName:"Authorized representative",repRole:"Representative's role",phone:"Contact phone",email:"Business email",county:"County",town:"Town",location:"Trading location",currentMethod:"Current payment method",device:"Merchant device",transactions:"Daily transaction estimate",ticket:"Typical sale amount",interest:"Preferred payment methods"};
 const OPTIONS={entityType:["Sole proprietor","Registered company","Partnership","Co-operative","Other"],sector:["Retail / supermarket","Market trader","Food & beverage","Transport & logistics","Professional services","Hospitality","Online / e-commerce","Other"],repRole:["Owner / proprietor","Director","Manager","Authorized employee"],currentMethod:["Lipa na M-Pesa Till","PayBill","Pochi la Biashara","Personal M-Pesa","Bank transfer / card","Cash only"],device:["Android phone with NFC","Android phone, NFC unsure","Android phone without NFC","iPhone","Other / unsure"],transactions:["1–10","11–30","31–100","101–300","301+"],ticket:["Below KES 500","KES 500–1,999","KES 2,000–9,999","KES 10,000–49,999","KES 50,000+"]};
 const LIMITS={legalName:120,tradeName:120,description:240,repName:120,phone:20,email:160,county:50,town:100,location:160};
 let allowed=[],captchaId=null,ready=false,sending=false;
 function option(value){const el=document.createElement("option");el.textContent=value;el.value=value;return el;}
 function field(key){const wrap=document.createElement("div"),label=document.createElement("label");label.className="label";label.textContent=KEYS[key]||key;
  let control;
  if(key==="interest"){
   control=document.createElement("select");control.multiple=true;control.size=3;
   for(const x of ["M-Pesa wallet","Bank cards","QR fallback"])control.append(option(x));
   const hint=document.createElement("small");hint.textContent="Select one or more (hold Cmd/Ctrl for multiple).";wrap.append(label,control,hint);
  }else if(OPTIONS[key]){control=document.createElement("select");control.append(option(""));for(const x of OPTIONS[key])control.append(option(x));wrap.append(label,control);}
  else{control=key==="description"?document.createElement("textarea"):document.createElement("input");if(key==="email")control.type="email";if(key==="phone")control.type="tel";if(LIMITS[key])control.maxLength=LIMITS[key];wrap.append(label,control);}
  control.id="fix_"+key;control.name=key;control.required=true;label.htmlFor=control.id;return wrap;
 }
 async function post(route,body){const response=await fetch("/api/merchant-corrections/"+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",credentials:"same-origin"});const data=await response.json().catch(()=>({message:`HTTP ${response.status}`}));if(!response.ok)throw Error(data.message||`HTTP ${response.status}`);return data;}
 function renderCaptcha(){if(captchaId!==null||!window.turnstile?.render)return;captchaId=window.turnstile.render("#captcha",{sitekey:$("captcha").dataset.sitekey,theme:"light"});}
 async function validate(){
  if(!/^[a-f0-9]{64}$/.test(token)){$("inviteState").textContent="No valid correction link supplied. Ask the M-Pay+ pilot team for a private link.";return;}
  try{const r=await post("validate",{token});allowed=r.fields;$("fields").replaceChildren(...allowed.map(field));$("inviteState").textContent=`Private request verified. Expires ${new Date(r.expiresAt).toLocaleString("en-KE")}. Only ${allowed.length} flagged field(s) can be updated.`;$("form").hidden=false;ready=true;renderCaptcha();}
  catch(e){$("inviteState").textContent=e.message;}
 }
 $("form").addEventListener("submit",async e=>{
  e.preventDefault();if(!ready||sending)return;
  const form=$("form"),data={};
  for(const key of allowed){const input=form.elements[key];if(key==="interest")data[key]=[...input.selectedOptions].map(v=>v.value);else data[key]=input.value.trim();if(!data[key]||Array.isArray(data[key])&&!data[key].length||!input.checkValidity()){$("message").textContent="Complete all requested fields before submitting.";input.focus();return;}}
  if(!$("confirm").checked){$("message").textContent="Confirm your corrections first.";return;}
  renderCaptcha();const proof=captchaId!==null?window.turnstile?.getResponse(captchaId):"";
  if(!proof){$("message").textContent="Complete the security check first.";return;}
  sending=true;$("submit").disabled=true;$("submit").textContent="Submitting…";$("message").textContent="Sending your corrections…";
  try{const response=await post("submit",{token,fields:data,turnstileToken:proof,confirmed:true,consentVersion:"pilot-correction-2026-10-15"});form.hidden=true;$("success").hidden=false;$("success").textContent="✓ Corrections submitted successfully. "+response.message;$("inviteState").textContent="Your correction request is complete. Contact the M-Pay+ pilot team if further changes are required.";}
  catch(e){$("message").textContent=e.message;$("submit").disabled=false;$("submit").textContent="Submit corrections for review";window.turnstile?.reset(captchaId);}
  finally{sending=false;}
 });
 validate();
})();
