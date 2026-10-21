"use strict";
// M-Pay+ Phase 7: synthetic/test-only correction requests.
// Keeps original onboarding submission immutable. No payments or regulated KYB.
const crypto=require("node:crypto");
const {onRequest}=require("firebase-functions/v2/https");
const {defineSecret}=require("firebase-functions/params");
const admin=require("firebase-admin");
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore(),turnstileSecret=defineSecret("TURNSTILE_SECRET");
const {isSiteOrigin,isSiteHost}=require("./hosts");
const HOME="https://m-pay-landing.web.app",TTL=72*3600*1000;
const BASIC=Object.freeze({legalName:120,tradeName:120,description:240,repName:120,phone:20,email:160,county:50,town:100,location:160});
const OPTIONS=Object.freeze({
 entityType:["Sole proprietor","Registered company","Partnership","Co-operative","Other"],
 sector:["Retail / supermarket","Market trader","Food & beverage","Transport & logistics","Professional services","Hospitality","Online / e-commerce","Other"],
 repRole:["Owner / proprietor","Director","Manager","Authorized employee"],
 currentMethod:["Lipa na M-Pesa Till","PayBill","Pochi la Biashara","Personal M-Pesa","Bank transfer / card","Cash only"],
 device:["Android phone with NFC","Android phone, NFC unsure","Android phone without NFC","iPhone","Other / unsure"],
 transactions:["1–10","11–30","31–100","101–300","301+"],
 ticket:["Below KES 500","KES 500–1,999","KES 2,000–9,999","KES 10,000–49,999","KES 50,000+"]
});
const METHODS=new Set(["M-Pesa wallet","Bank cards","QR fallback"]);
const ALLOWED=new Set([...Object.keys(BASIC),...Object.keys(OPTIONS),"interest"]);
const CONSENT="pilot-correction-2026-10-15";
const bad=(res,status,message)=>res.status(status).json({ok:false,message});
const tokenOK=s=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const appOK=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,128}$/.test(s);
const hash=t=>crypto.createHash("sha256").update(t).digest("hex");
const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
const time=t=>t&&typeof t.toDate==="function"?t.toDate().toISOString():null;
const ctl=s=>/[\u0000-\u001f\u007f]/.test(s);
function validatePatch(fields,required){
 if(!fields||typeof fields!=="object"||Array.isArray(fields))return null;
 if(!Array.isArray(required)||!required.length||required.some(k=>!ALLOWED.has(k)))return null;
 const keys=Object.keys(fields);
 if(keys.length!==required.length||keys.some(k=>!required.includes(k)))return null;
 const out={};
 for(const k of required){
  const value=fields[k];
  if(k==="interest"){
   if(!Array.isArray(value)||!value.length||value.length>3||new Set(value).size!==value.length||value.some(x=>!METHODS.has(x)))return null;
   out[k]=value;continue;
  }
  if(typeof value!=="string")return null;
  const v=value.trim();
  if(k in BASIC){if(v.length<2||v.length>BASIC[k]||ctl(v))return null;}
  else if(!OPTIONS[k]?.includes(v))return null;
  if(k==="phone"&&!/^\+?[0-9 ()-]{9,20}$/.test(v))return null;
  if(k==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return null;
  out[k]=v;
 }
 return out;
}
function refs(applicationId,requestId){
 const a=db.collection("pilotApplications").doc(applicationId);
 return {application:a,initial:a.collection("merchantOnboardingSubmissions").doc("initial"),
  review:a.collection("merchantOnboardingReviews").doc("administrative"),
  request:requestId?a.collection("merchantCorrectionRequests").doc(requestId):null,
  submission:requestId?a.collection("merchantCorrectionSubmissions").doc(requestId):null};
}
function readJSON(req,res){
 if(!req.is("application/json")){bad(res,415,"JSON required.");return null;}
 if(!req.body||typeof req.body!=="object"||Array.isArray(req.body)||Buffer.byteLength(JSON.stringify(req.body))>8000){bad(res,400,"Invalid or oversized request.");return null;}
 return req.body;
}
async function staff(req,res){
 const match=/^Bearer (\S+)$/.exec(req.get("authorization")||"");
 if(!match){bad(res,401,"Staff sign-in required.");return null;}
 try{const u=await admin.auth().verifyIdToken(match[1],true);
  if(!["admin","reviewer"].includes(u.mpayRole)){bad(res,403,"Staff role required.");return null;}
  return u;
 }catch{bad(res,401,"Session expired. Sign in again.");return null;}
}
function denyInvite(res){return bad(res,410,"Correction link invalid, expired or already used. Contact M-Pay+ staff.");}
async function validInvite(raw){
 if(!tokenOK(raw))return null;
 const digest=hash(raw),link=db.collection("pilotCorrectionInvites").doc(digest);
 const tokenSnap=await link.get();if(!tokenSnap.exists)return null;
 const t=tokenSnap.data();if(t.usedAt||!t.expiresAt?.toMillis||t.expiresAt.toMillis()<=Date.now())return null;
 if(!appOK(t.applicationId)||!appOK(t.requestId))return null;
 const r=refs(t.applicationId,t.requestId);
 const [app,request,review]=await Promise.all([r.application.get(),r.request.get(),r.review.get()]);
 if(!app.exists||!request.exists||!review.exists)return null;
 const q=request.data(),v=review.data();
 if(q.status!=="issued"||q.tokenHash!==digest||q.reviewVersion!==v.version||v.status!=="corrections_needed"||app.data().status==="declined"||app.data().correctionRequest?.id!==t.requestId)return null;
 return {link,digest,q,r,t};
}
async function verifyTurnstile(response,ip){
 if(typeof response!=="string"||!response||response.length>2048)return false;
 const secret=turnstileSecret.value();if(typeof secret!=="string"||secret.length<12)return false;
 const result=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({secret,response,remoteip:ip}),signal:AbortSignal.timeout(6500)
 });
 if(!result.ok)return false;
 const data=await result.json();return data.success===true&&isSiteHost(data.hostname);
}
exports.merchantCorrections=onRequest({region:"us-central1",timeoutSeconds:20,memory:"256MiB",maxInstances:3,invoker:"public",secrets:[turnstileSecret]},async(req,res)=>{
 res.set({"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Vary":"Origin"});
 if(req.method!=="POST")return bad(res,405,"POST required.");
 const origin=req.get("origin");if(origin&&!isSiteOrigin(origin))return bad(res,403,"Unexpected request origin.");
 const route=req.path.replace(/^\/api\/merchant-corrections(?=\/|$)/,"");
 const body=readJSON(req,res);if(!body)return;
 try{
  if(route.startsWith("/admin/")){
   const u=await staff(req,res);if(!u)return;
   const applicationId=body.applicationId;
   if(!appOK(applicationId))return bad(res,400,"Invalid application.");
   if(route==="/admin/detail"){
    if(Object.keys(body).length!==1)return bad(res,400,"Invalid detail request.");
    const r=refs(applicationId);const a=await r.application.get();if(!a.exists)return bad(res,404,"Application not found.");
    const active=a.data().correctionRequest||null;
    if(!active)return res.json({ok:true,state:"not_requested",request:null,submission:null});
    const [q,s]=await Promise.all([a.ref.collection("merchantCorrectionRequests").doc(active.id).get(),a.ref.collection("merchantCorrectionSubmissions").doc(active.id).get()]);
    if(!q.exists)return bad(res,409,"Correction request missing; contact administrator.");
    const rec=q.data();
    return res.json({ok:true,state:rec.status,request:{fields:rec.fields,reviewVersion:rec.reviewVersion,
     expiresAt:time(rec.expiresAt),issuedAt:time(rec.issuedAt),submittedAt:time(rec.submittedAt)},
     submission:s.exists?s.data().fields:null});
   }
   if(route==="/admin/issue"){
    if(u.mpayRole!=="admin")return bad(res,403,"Administrator permission required.");
    if(!Number.isSafeInteger(body.expectedReviewVersion)||body.expectedReviewVersion<1||Object.keys(body).length!==2)return bad(res,400,"Expected review version required.");
    const token=crypto.randomBytes(32).toString("hex"),digest=hash(token),requestId=crypto.randomUUID();
    const expiresAt=admin.firestore.Timestamp.fromMillis(Date.now()+TTL),r=refs(applicationId,requestId),link=db.collection("pilotCorrectionInvites").doc(digest);
    await db.runTransaction(async tx=>{
     const [a,s,v]=await Promise.all([tx.get(r.application),tx.get(r.initial),tx.get(r.review)]);
     if(!a.exists||!s.exists){const e=Error("Application or onboarding submission missing.");e.code="MISSING";throw e;}
     if(!v.exists||v.data().status!=="corrections_needed"||v.data().version!==body.expectedReviewVersion){const e=Error("Refresh review: corrections-needed decision has changed.");e.code="REVIEW";throw e;}
     const flags=v.data().flags||[];
     if(!flags.length||flags.some(k=>!ALLOWED.has(k))){const e=Error("Flagged fields include declarations or unsupported corrections. Resolve through a verified channel.");e.code="FIELDS";throw e;}
     const prior=a.data().correctionRequest;
     if(prior&&prior.reviewVersion===v.data().version&&prior.state==="submitted"){
      const e=Error("Corrections already submitted for this review. Make a new review decision first.");e.code="DONE";throw e;
     }
     const request={fields:flags,reviewVersion:v.data().version,status:"issued",tokenHash:digest,
      issuedAt:stamp(),expiresAt,issuedByUid:u.uid,issuedByEmail:u.email||null};
     tx.create(r.request,request);
     tx.create(link,{applicationId,requestId,expiresAt,usedAt:null});
     tx.update(r.application,{correctionRequest:{id:requestId,state:"issued",reviewVersion:v.data().version},updatedAt:stamp()});
     tx.create(db.collection("pilotAdminAudit").doc(),{applicationId,action:"merchant_correction_invited",flagFields:flags,
      actorUid:u.uid,actorEmail:u.email||null,at:stamp()});
    });
    return res.json({ok:true,url:`${HOME}/merchant-correction.html#token=${token}`,expiresAt:expiresAt.toDate().toISOString(),fields:"only flagged fields"});
   }
   return bad(res,404,"Not found.");
  }
  if(route==="/validate"){
   if(Object.keys(body).length!==1)return bad(res,400,"Invalid request.");
   const state=await validInvite(body.token);if(!state)return denyInvite(res);
   return res.json({ok:true,fields:state.q.fields,expiresAt:state.q.expiresAt.toDate().toISOString()});
  }
  if(route==="/submit"){
   if(Object.keys(body).some(k=>!["token","fields","turnstileToken","confirmed","consentVersion"].includes(k)))return bad(res,400,"Invalid submission.");
   const state=await validInvite(body.token);if(!state)return denyInvite(res);
   if(body.confirmed!==true||body.consentVersion!==CONSENT)return bad(res,400,"Please confirm your corrections.");
   const patch=validatePatch(body.fields,state.q.fields);if(!patch)return bad(res,400,"Provide valid corrections for the requested fields only.");
   const ip=String(req.get("x-forwarded-for")||"").split(",")[0].trim()||req.ip||"";
   let verified=false;try{verified=await verifyTurnstile(body.turnstileToken,ip);}catch{return bad(res,503,"Security verification is temporarily unavailable.");}
   if(!verified)return bad(res,403,"Security check failed. Try again.");
   await db.runTransaction(async tx=>{
    const [app,review,request,link]=await Promise.all([tx.get(state.r.application),tx.get(state.r.review),tx.get(state.r.request),tx.get(state.link)]);
    if(!app.exists||!review.exists||!request.exists||!link.exists||link.data().usedAt||
      link.data().expiresAt.toMillis()<=Date.now()||request.data().status!=="issued"||
      request.data().tokenHash!==state.digest||review.data().version!==request.data().reviewVersion||
      review.data().status!=="corrections_needed"||app.data().correctionRequest?.id!==state.t.requestId){
      const e=Error("Consumed or changed request.");e.code="EXPIRED";throw e;
    }
    tx.create(state.r.submission,{fields:patch,reviewVersion:state.q.reviewVersion,submittedAt:stamp(),consentVersion:CONSENT,source:"merchant-correction"});
    tx.update(state.r.request,{status:"submitted",submittedAt:stamp()});
    tx.update(state.link,{usedAt:stamp()});
    tx.update(state.r.application,{correctionRequest:{id:state.t.requestId,state:"submitted",reviewVersion:state.q.reviewVersion},updatedAt:stamp()});
    tx.create(db.collection("pilotAdminAudit").doc(),{applicationId:state.t.applicationId,action:"merchant_correction_submitted",
     flagFields:state.q.fields,at:stamp(),source:"merchant-correction"});
   });
   return res.json({ok:true,message:"Corrections received for administrative review. No payment account has been activated."});
  }
  return bad(res,404,"Not found.");
 }catch(e){
  if(e.code==="MISSING")return bad(res,404,e.message);
  if(e.code==="REVIEW"||e.code==="FIELDS"||e.code==="DONE")return bad(res,409,e.message);
  if(e.code==="EXPIRED"||e.code===6)return denyInvite(res);
  console.error("merchantCorrections failure",{code:String(e.code||"internal")});
  return bad(res,503,"Temporary service error. Try again later.");
 }
});
module.exports._test={validatePatch,tokenOK,ALLOWED};
