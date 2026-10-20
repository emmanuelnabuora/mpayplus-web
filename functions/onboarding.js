"use strict";
// M-Pay+ pilot onboarding invitations. Not a payment account or regulated KYB workflow.
const crypto = require("node:crypto");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const turnstileSecret = defineSecret("TURNSTILE_SECRET");
const HOME = "https://m-pay-landing.web.app";
const TTL_MS = 72 * 60 * 60 * 1000;
const INVITES = "pilotOnboardingInvites";
const APPLICATIONS = "pilotApplications";
const ONBOARDING_DOC = "initial";
const bad = (res,status,message) => res.status(status).json({ok:false,message});
const text = v => typeof v === "string" ? v.trim() : "";
const hasControls = s => /[\u0000-\u001f\u007f]/.test(s);
const validId = s => /^[A-Za-z0-9_-]{1,128}$/.test(s);
const validToken = s => /^[a-f0-9]{64}$/.test(s);
const hash = t => crypto.createHash("sha256").update(t).digest("hex");
const ts = () => admin.firestore.FieldValue.serverTimestamp();
const OPTIONS = Object.freeze({
  entityType:["Sole proprietor","Registered company","Partnership","Co-operative","Other"],
  sector:["Retail / supermarket","Market trader","Food & beverage","Transport & logistics","Professional services","Hospitality","Online / e-commerce","Other"],
  repRole:["Owner / proprietor","Director","Manager","Authorized employee"],
  currentMethod:["Lipa na M-Pesa Till","PayBill","Pochi la Biashara","Personal M-Pesa","Bank transfer / card","Cash only"],
  device:["Android phone with NFC","Android phone, NFC unsure","Android phone without NFC","iPhone","Other / unsure"],
  transactions:["1–10","11–30","31–100","101–300","301+"],
  ticket:["Below KES 500","KES 500–1,999","KES 2,000–9,999","KES 10,000–49,999","KES 50,000+"]
});
const METHODS = new Set(["M-Pesa wallet", "Bank cards", "QR fallback"]);
const BASIC = Object.freeze({legalName:120,tradeName:120,description:240,repName:120,phone:20,email:160,county:50,town:100,location:160});
const CONSENT_VERSION = "pilot-onboarding-2026-10-15";
function parse(req,res,max=6000) {
  if(!req.is("application/json")){bad(res,415,"JSON required.");return null;}
  if(Number(req.get("content-length")||0)>max){bad(res,413,"Request too large.");return null;}
  if(!req.body||typeof req.body!=="object"||Array.isArray(req.body)){bad(res,400,"Invalid request.");return null;}
  return req.body;
}
function validateForm(body) {
  if(!body || typeof body!=="object" || Array.isArray(body)) return null;
  const required = [...Object.keys(BASIC),...Object.keys(OPTIONS),"interest","declarationAuthority","declarationContact","declarationPilot","consentVersion"];
  if(Object.keys(body).some(k=>!required.includes(k))) return null;
  const record={};
  for(const [key,max] of Object.entries(BASIC)){
    if(typeof body[key]!=="string")return null;
    const v=body[key].trim();
    if(v.length<2||v.length>max||hasControls(v))return null;
    record[key]=v;
  }
  for(const [key,valid] of Object.entries(OPTIONS)){
    if(!valid.includes(body[key]))return null;
    record[key]=body[key];
  }
  if(!/^\+?[0-9 ()-]{9,20}$/.test(record.phone))return null;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email))return null;
  if(!Array.isArray(body.interest)||body.interest.length>3 ||
    new Set(body.interest).size!==body.interest.length || body.interest.some(x=>!METHODS.has(x)))return null;
  for(const k of ["declarationAuthority","declarationContact","declarationPilot"]){if(body[k]!==true)return null;}
  if(body.consentVersion!==CONSENT_VERSION)return null;
  return {...record,interest:body.interest,consentVersion:CONSENT_VERSION};
}
async function confirmTurnstile(token,secret,ip) {
  if(typeof secret!=="string" || secret.length<12)return false;
  if(!token||typeof token!=="string"||token.length>2048)return false;
  const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({secret,response:token,remoteip:ip}),signal:AbortSignal.timeout(6500)
  });
  if(!response.ok)return false;
  const result=await response.json();
  return result.success===true && result.hostname==="m-pay-landing.web.app";
}
async function inviteState(rawToken) {
  if(!validToken(rawToken))return null;
  const digest=hash(rawToken),ref=db.collection(INVITES).doc(digest);
  const invite=await ref.get();
  if(!invite.exists)return null;
  const inv=invite.data();
  if(inv.usedAt||!inv.expiresAt?.toMillis || inv.expiresAt.toMillis()<=Date.now())return null;
  const app=await db.collection(APPLICATIONS).doc(inv.applicationId).get();
  if(!app.exists || app.data().onboardingInviteHash!==digest || app.data().status==="declined")return null;
  return {inviteRef:ref,inv,appRef:app.ref,app};
}
async function authorizedAdmin(req,res) {
  const m=/^Bearer (\S+)$/.exec(req.get("authorization")||"");
  if(!m){bad(res,401,"Staff sign-in required.");return null;}
  try {
    const id=await admin.auth().verifyIdToken(m[1],true);
    if(!["admin","reviewer"].includes(id.mpayRole)){bad(res,403,"Staff role required.");return null;}
    return id;
  } catch {bad(res,401,"Session expired; sign in again.");return null;}
}
function admission(res) {return bad(res,410,"Invitation invalid, expired or already used. Ask M-Pay+ staff for a fresh invitation.");}
// Cloud Function exported by functions/index.js. Admin and merchant endpoints share the same
// function but use disjoint auth flows and paths. Never log tokens, links or onboarding PII.
exports.merchantOnboarding = onRequest({region:"us-central1",timeoutSeconds:20,memory:"256MiB",maxInstances:3,invoker:"public",secrets:[turnstileSecret]},async(req,res)=>{
  res.set({"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Vary":"Origin"});
  if(req.method!=="POST")return bad(res,405,"POST required.");
  const origin=req.get("Origin");
  if(origin && origin!==HOME)return bad(res,403,"Unexpected request origin.");
  const path=req.path.replace(/^\/api\/merchant-onboarding(?=\/|$)/,"");
  const body=parse(req,res);if(!body)return;
  try {
    if(path.startsWith("/admin/")) {
      const user=await authorizedAdmin(req,res);if(!user)return;
      if(path==="/admin/invite") {
        if(user.mpayRole!=="admin")return bad(res,403,"Only administrators can issue invitations.");
        const id=text(body.applicationId);
        if(!validId(id)||Object.keys(body).some(k=>k!=="applicationId"))return bad(res,400,"Invalid application ID.");
        const appRef=db.collection(APPLICATIONS).doc(id);
        const token=crypto.randomBytes(32).toString("hex"),digest=hash(token);
        const inviteRef=db.collection(INVITES).doc(digest);
        const expiresAt=admin.firestore.Timestamp.fromMillis(Date.now()+TTL_MS);
        await db.runTransaction(async tx=>{
          const app=await tx.get(appRef);
          if(!app.exists){const e=new Error("MISSING");e.code="MISSING";throw e;}
          if(app.data().status!=="screening"){const e=new Error("SCREEN");e.code="SCREEN";throw e;}
          if(app.data().merchantOnboarding?.state==="submitted"){const e=new Error("SUBMITTED");e.code="SUBMITTED";throw e;}
          tx.create(inviteRef,{applicationId:id,issuedAt:ts(),expiresAt,issuedBy:user.uid,usedAt:null});
          tx.update(appRef,{onboardingInviteHash:digest,merchantOnboarding:{state:"invited",invitedAt:ts(),expiresAt},updatedAt:ts()});
          tx.create(db.collection("pilotAdminAudit").doc(),{applicationId:id,action:"onboarding_invited",actorUid:user.uid,actorEmail:user.email||null,at:ts()});
        });
        return res.json({ok:true,url:`${HOME}/merchant-onboarding.html#invite=${token}`,expiresAt:expiresAt.toDate().toISOString()});
      }
      if(path==="/admin/detail"){
        if(!validId(text(body.applicationId)))return bad(res,400,"Invalid application ID.");
        const appRef=db.collection(APPLICATIONS).doc(body.applicationId);
        const [app,submission]=await Promise.all([appRef.get(),appRef.collection("merchantOnboardingSubmissions").doc(ONBOARDING_DOC).get()]);
        if(!app.exists)return bad(res,404,"Application not found.");
        const onboarding=app.data().merchantOnboarding||{state:"not_invited"};
        return res.json({ok:true,state:onboarding.state||"not_invited",expiresAt:onboarding.expiresAt?.toDate?.()?.toISOString()||null,
          submission:submission.exists?{...submission.data().fields,submittedAt:submission.data().submittedAt?.toDate?.()?.toISOString()||null}:null});
      }
      return bad(res,404,"Not found.");
    }
    if(path==="/validate") {
      if(Object.keys(body).some(k=>k!=="invite"))return bad(res,400,"Invalid request.");
      const state=await inviteState(body.invite);
      if(!state)return admission(res);
      return res.json({ok:true,business:state.app.data().business||"Business applicant",expiresAt:state.inv.expiresAt.toDate().toISOString()});
    }
    if(path==="/submit") {
      if(Object.keys(body).some(k=>!["invite","fields","turnstileToken"].includes(k)))return bad(res,400,"Invalid request.");
      const fields=validateForm(body.fields);
      if(!fields)return bad(res,400,"Check all required business and contact fields, then confirm the declarations.");
      const state=await inviteState(body.invite);
      if(!state)return admission(res);
      const clientIp=text(req.get("x-forwarded-for")||"").split(",")[0]||req.ip||"";
      let verified=false;
      try{verified=await confirmTurnstile(body.turnstileToken,turnstileSecret.value(),clientIp);}catch{
        return bad(res,503,"Security verification is temporarily unavailable.");
      }
      if(!verified)return bad(res,403,"Security verification failed. Please try again.");
      await db.runTransaction(async tx=>{
        const [inv,app]=await Promise.all([tx.get(state.inviteRef),tx.get(state.appRef)]);
        if(!inv.exists||inv.data().usedAt||inv.data().expiresAt.toMillis()<=Date.now()||
          !app.exists||app.data().onboardingInviteHash!==state.inviteRef.id||app.data().status==="declined"){
          const e=new Error("EXPIRED");e.code="EXPIRED";throw e;
        }
        const subRef=state.appRef.collection("merchantOnboardingSubmissions").doc(ONBOARDING_DOC);
        tx.create(subRef,{fields,submittedAt:ts(),consentVersion:CONSENT_VERSION,source:"invited-merchant-form"});
        tx.update(state.inviteRef,{usedAt:ts()});
        tx.update(state.appRef,{merchantOnboarding:{state:"submitted",submittedAt:ts()},onboardingInviteHash:admin.firestore.FieldValue.delete(),updatedAt:ts()});
        tx.create(db.collection("pilotAdminAudit").doc(),{applicationId:state.inv.applicationId,action:"onboarding_submitted",at:ts(),source:"merchant-invite"});
      });
      return res.json({ok:true,message:"Your onboarding details have been submitted for review. No payment account has been activated."});
    }
    return bad(res,404,"Not found.");
  }catch(e){
    if(e.code==="MISSING")return bad(res,404,"Application not found.");
    if(e.code==="SCREEN")return bad(res,409,"Move the application to Screening before issuing an invitation.");
    if(e.code==="SUBMITTED")return bad(res,409,"An onboarding submission already exists.");
    if(e.code==="EXPIRED"||e.code===6)return admission(res);
    console.error("merchantOnboarding failure",{code:e.code||"internal"});
    return bad(res,503,"Temporary service error. Please retry later.");
  }
});
module.exports._test={validateForm,validToken,hash,CONSENT_VERSION};
