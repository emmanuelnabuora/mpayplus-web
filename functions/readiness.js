"use strict";
// M-Pay+ Phase 8: decision on Phase 7 correction amendments, and administrative
// readiness assessment. Test/synthetic data only. No partner-KYB or payments.
const {onRequest}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore();
const HOME="https://m-pay-landing.web.app";
const FIELDS=new Set(["legalName","tradeName","description","entityType","sector","repName","repRole","phone","email","county","town","location","currentMethod","device","transactions","ticket","interest"]);
const CHECKLIST=["initial_contact","business_review","pilot_briefing","terms_acknowledgement","demo_walkthrough","readiness_review"];
const bad=(res,status,message)=>res.status(status).json({ok:false,message});
const validId=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const saneNote=v=>typeof v==="string"&&v.length<=400&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const when=t=>typeof t?.toDate==="function"?t.toDate().toISOString():null;
const decisionView=s=>s.exists?{state:s.data().state,requestId:s.data().requestId,reviewVersion:s.data().reviewVersion,reviewedAt:when(s.data().reviewedAt),reviewedBy:s.data().reviewedByEmail||null,note:s.data().note||""}:null;
const refs=id=>{const app=db.collection("pilotApplications").doc(id);return {app,
 initial:app.collection("merchantOnboardingSubmissions").doc("initial"),
 review:app.collection("merchantOnboardingReviews").doc("administrative")};};
function assessment(application,hasInitial,review,request,decision){
 const blockers=[];
 if(!hasInitial)blockers.push("Initial merchant onboarding form not submitted");
 if(application.status==="declined")blockers.push("Pilot application is declined");
 if(application.status!=="screening")blockers.push("Pilot application must be in Screening");
 if(!application.assignedTo?.uid)blockers.push("No authorized staff member assigned");
 for(const key of CHECKLIST)if(application.onboarding?.[key]?.completed!==true)
  blockers.push(`Onboarding checklist incomplete: ${key.replaceAll("_"," ")}`);
 if(application.verification?.state!=="reviewed")blockers.push("Internal business review is not marked reviewed");
 if(review?.status!=="ready_for_partner_review"||(review.flags||[]).length)
  blockers.push("Administrative review must be ready for partner review with no open flags");
 if(request && request.status==="submitted" && decision?.state!=="accepted")
  blockers.push("Submitted merchant correction is awaiting acceptance");
 if(request && request.status==="issued")blockers.push("Correction request is outstanding");
 // If the latest correction was rejected, it must not become administratively ready
 // merely by clearing flags without resolving the correction cycle.
 if(decision?.state==="rejected")blockers.push("Latest correction was rejected; a new review cycle is required");
 return {state:blockers.length?"action_required":"administratively_ready_for_partner_review",blockers,
  checklistCompleted:CHECKLIST.filter(key=>application.onboarding?.[key]?.completed===true).length,
  checklistTotal:CHECKLIST.length,
  notice:"Administrative readiness only. Not KYB/KYC approval, licensed partner verification, or payment authorization."};
}
async function identity(req,res){
 const match=/^Bearer (\S+)$/.exec(req.get("authorization")||"");
 if(!match){bad(res,401,"Staff sign-in required.");return null;}
 try{const user=await admin.auth().verifyIdToken(match[1],true);
  if(!["admin","reviewer"].includes(user.mpayRole)){bad(res,403,"Provisioned staff role required.");return null;}
  return user;
 }catch{bad(res,401,"Session expired. Sign in again.");return null;}
}
exports.pilotMerchantReadiness=onRequest({region:"us-central1",memory:"256MiB",timeoutSeconds:20,maxInstances:3,invoker:"public"},async(req,res)=>{
 res.set({"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Vary":"Origin"});
 if(req.method!=="POST")return bad(res,405,"POST required.");
 const origin=req.get("origin");if(origin&&origin!==HOME)return bad(res,403,"Unexpected request origin.");
 if(!req.is("application/json"))return bad(res,415,"JSON required.");
 const body=req.body;
 if(!body||typeof body!=="object"||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>3000)return bad(res,400,"Invalid request.");
 const user=await identity(req,res);if(!user)return;
 const route=req.path.replace(/^\/api\/merchant-readiness(?=\/|$)/,"");
 if(!validId(body.applicationId))return bad(res,400,"Invalid application ID.");
 const {app,initial,review}=refs(body.applicationId);
 try{
  if(route==="/admin/detail"){
   if(Object.keys(body).length!==1)return bad(res,400,"Invalid request fields.");
   const [a,s,v]=await Promise.all([app.get(),initial.get(),review.get()]);
   if(!a.exists)return bad(res,404,"Application not found.");
   const pointer=a.data().correctionRequest;
   let q=null,t=null,d=null;
   if(pointer?.id&&validId(pointer.id)){
    const [qs,ts,ds]=await Promise.all([
     app.collection("merchantCorrectionRequests").doc(pointer.id).get(),
     app.collection("merchantCorrectionSubmissions").doc(pointer.id).get(),
     app.collection("merchantCorrectionDecisions").doc(pointer.id).get()
    ]);
    if(!qs.exists)return bad(res,409,"Correction request missing; contact administrator.");
    q={...qs.data(),requestId:pointer.id};t=ts.exists?ts.data():null;d=decisionView(ds);
   }
   const r=v.exists?v.data():null;
   const original=s.exists?(s.data().fields||s.data()):null;
   // Only return original/corrected values for fields explicitly flagged by latest request.
   const requested=q?.fields||[];const base={};const changed={};
   for(const f of requested){if(!FIELDS.has(f))continue;
    if(original&&Object.hasOwn(original,f))base[f]=original[f];
    if(t?.fields&&Object.hasOwn(t.fields,f))changed[f]=t.fields[f];}
   const compliance=assessment(a.data(),s.exists,r,q,d);
   return res.json({ok:true,requestId:pointer?.id||null,request:{status:q?.status||"not_requested",fields:requested,
    reviewVersion:q?.reviewVersion||null,submittedAt:when(q?.submittedAt)},
    original:base,corrected:changed,decision:d,review:{status:r?.status||"not_started",version:r?.version||0,flags:r?.flags||[]},readiness:compliance});
  }
  if(route==="/admin/decision"){
   if(user.mpayRole!=="admin")return bad(res,403,"Administrator permission required.");
   if(Object.keys(body).some(k=>!["applicationId","requestId","expectedReviewVersion","state","note"].includes(k))||
    !validId(body.requestId)||!Number.isSafeInteger(body.expectedReviewVersion)||body.expectedReviewVersion<1||
    !["accepted","rejected"].includes(body.state)||!saneNote(body.note))return bad(res,400,"Invalid decision.");
   const note=body.note.trim();if(body.state==="rejected"&&note.length<8)return bad(res,400,"Explain why the correction is rejected (at least eight characters).");
   const reqRef=app.collection("merchantCorrectionRequests").doc(body.requestId);
   const amendRef=app.collection("merchantCorrectionSubmissions").doc(body.requestId);
   const decRef=app.collection("merchantCorrectionDecisions").doc(body.requestId);
   await db.runTransaction(async tx=>{
    const [a,r,q,s,d]=await Promise.all([tx.get(app),tx.get(review),tx.get(reqRef),tx.get(amendRef),tx.get(decRef)]);
    if(!a.exists||!r.exists||!q.exists||!s.exists){const e=Error("No submitted correction is available for decision.");e.code="MISSING";throw e;}
    if(d.exists){const e=Error("This amendment already has a final decision. Start a new review cycle if needed.");e.code="DECIDED";throw e;}
    if(a.data().correctionRequest?.id!==body.requestId||a.data().correctionRequest?.state!=="submitted"||
     q.data().status!=="submitted"||q.data().reviewVersion!==body.expectedReviewVersion||
     r.data().version!==body.expectedReviewVersion||r.data().status!=="corrections_needed"){
      const e=Error("Correction or review has changed. Refresh and try again.");e.code="CONFLICT";throw e;
    }
    const requested=q.data().fields||[],submitted=s.data().fields||{};
    if(!requested.length||requested.some(f=>!FIELDS.has(f)||!Object.hasOwn(submitted,f))||
      Object.keys(submitted).length!==requested.length){const e=Error("Submitted amendment does not match the flagged fields.");e.code="FIELDS";throw e;}
    const timestamp=admin.firestore.FieldValue.serverTimestamp();
    tx.create(decRef,{requestId:body.requestId,state:body.state,reviewVersion:body.expectedReviewVersion,
     note,reviewedByUid:user.uid,reviewedByEmail:user.email||null,reviewedAt:timestamp});
    // Do NOT overwrite original onboarding, amended merchant values, or Phase 6 review.
    tx.create(db.collection("pilotAdminAudit").doc(),{applicationId:body.applicationId,
     action:"merchant_correction_decision",decision:body.state,reviewVersion:body.expectedReviewVersion,
     flagFields:requested,actorUid:user.uid,actorEmail:user.email||null,at:timestamp});
   });
   return res.json({ok:true,state:body.state,message:"Correction decision saved. Update the separate Phase 6 review after resolving discrepancies. No payment services activated."});
  }
  return bad(res,404,"Not found.");
 }catch(e){
  if(e.code==="MISSING")return bad(res,409,e.message);
  if(["CONFLICT","DECIDED","FIELDS",6].includes(e.code))return bad(res,409,e.message||"Conflict. Refresh the review.");
  console.error("pilotMerchantReadiness error",{code:String(e.code||"internal")});
  return bad(res,503,"Temporary service error. Try again later.");
 }
});
module.exports._test={assessment,validId};
