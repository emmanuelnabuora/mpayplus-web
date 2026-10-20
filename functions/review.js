"use strict";
// M-Pay+ Phase 6: internal, administrative review of pilot onboarding submissions.
// Does NOT verify merchant identity, approve regulated KYB, or activate payments.
const {onRequest}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore();
const ORIGIN="https://m-pay-landing.web.app";
const STATES=new Set(["reviewing","corrections_needed","ready_for_partner_review","closed_no_pilot"]);
const FLAG_FIELDS=new Set([
 "legalName","tradeName","description","entityType","sector","repName","repRole",
 "phone","email","county","town","location","currentMethod","device",
 "transactions","ticket","interest","declarations"
]);
const bad=(res,code,message)=>res.status(code).json({ok:false,message});
const idValid=id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const safeNote=s=>typeof s==="string"&&s.length<=600&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
const iso=stamp=>stamp&&typeof stamp.toDate==="function"?stamp.toDate().toISOString():null;
function validReview(input){
 if(!input||typeof input!=="object"||Array.isArray(input))return null;
 if(Object.keys(input).some(k=>!["applicationId","expectedVersion","status","flags","note"].includes(k)))return null;
 if(!idValid(input.applicationId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)return null;
 if(!STATES.has(input.status)||!Array.isArray(input.flags)||input.flags.length>FLAG_FIELDS.size)return null;
 const unique=[...new Set(input.flags)];
 if(unique.length!==input.flags.length||unique.some(f=>!FLAG_FIELDS.has(f)))return null;
 if(!safeNote(input.note))return null;
 const note=input.note.trim();
 if(input.status==="corrections_needed" && (!unique.length||note.length<8))return null;
 if(input.status==="ready_for_partner_review" && unique.length)return null;
 if(input.status==="closed_no_pilot" && note.length<8)return null;
 return {applicationId:input.applicationId,expectedVersion:input.expectedVersion,status:input.status,flags:unique,note};
}
async function authenticate(req,res){
 const bearer=/^Bearer (\S+)$/.exec(req.get("authorization")||"");
 if(!bearer){bad(res,401,"Staff sign-in required.");return null;}
 try{
  const u=await admin.auth().verifyIdToken(bearer[1],true);
  if(!["admin","reviewer"].includes(u.mpayRole)){bad(res,403,"Staff role required.");return null;}
  return u;
 }catch{bad(res,401,"Session expired. Sign in again.");return null;}
}
function refs(applicationId){
 const application=db.collection("pilotApplications").doc(applicationId);
 return {application,submission:application.collection("merchantOnboardingSubmissions").doc("initial"),
  review:application.collection("merchantOnboardingReviews").doc("administrative")};
}
function view(review){
 return review.exists?{
  status:review.data().status||"reviewing",flags:review.data().flags||[],
  note:review.data().note||"",version:review.data().version||0,
  updatedAt:iso(review.data().updatedAt),updatedBy:review.data().updatedByEmail||null
 }:{status:"not_started",flags:[],note:"",version:0,updatedAt:null,updatedBy:null};
}
exports.pilotOnboardingReview=onRequest({region:"us-central1",timeoutSeconds:20,memory:"256MiB",maxInstances:3,invoker:"public"},async(req,res)=>{
 res.set({"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Vary":"Origin"});
 if(req.method!=="POST")return bad(res,405,"POST required.");
 const origin=req.get("origin");if(origin&&origin!==ORIGIN)return bad(res,403,"Unexpected request origin.");
 if(!req.is("application/json"))return bad(res,415,"JSON required.");
 if(Number(req.get("content-length")||0)>4000)return bad(res,413,"Request too large.");
 if(!req.body||typeof req.body!=="object"||Array.isArray(req.body))return bad(res,400,"Invalid request.");
 const u=await authenticate(req,res);if(!u)return;
 const route=req.path.replace(/^\/api\/onboarding-review(?=\/|$)/,"");
 try{
  if(route==="/detail"){
   if(Object.keys(req.body).length!==1||!idValid(req.body.applicationId))return bad(res,400,"Invalid application ID.");
   const {application,submission,review}=refs(req.body.applicationId);
   const [a,s,r]=await Promise.all([application.get(),submission.get(),review.get()]);
   if(!a.exists)return bad(res,404,"Application not found.");
   if(!s.exists)return res.json({ok:true,hasSubmission:false,review:view(r)});
   return res.json({ok:true,hasSubmission:true,review:view(r)});
  }
  if(route==="/save"){
   if(u.mpayRole!=="admin")return bad(res,403,"Administrator permission required.");
   const input=validReview(req.body);if(!input)return bad(res,400,"Review status, flags or note invalid.");
   const {application,submission,review}=refs(input.applicationId);
   let saved;
   await db.runTransaction(async tx=>{
    // All reads before writes; optimistic version guards against overlapping edits.
    const [a,s,r]=await Promise.all([tx.get(application),tx.get(submission),tx.get(review)]);
    if(!a.exists){const e=new Error("MISSING");e.code="MISSING";throw e;}
    if(!s.exists||a.data().merchantOnboarding?.state!=="submitted"){
     const e=new Error("NO_SUBMISSION");e.code="NO_SUBMISSION";throw e;
    }
    const old=view(r);
    if(input.expectedVersion!==old.version){const e=new Error("CONFLICT");e.code="CONFLICT";throw e;}
    const nextVersion=old.version+1;
    const update={status:input.status,flags:input.flags,note:input.note,version:nextVersion,
      updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedByUid:u.uid,updatedByEmail:u.email||null};
    tx.set(review,update);
    // Audit records contain no private notes, onboarding form data, or credentials.
    tx.create(db.collection("pilotAdminAudit").doc(),{applicationId:input.applicationId,
      action:"onboarding_admin_review",fromStatus:old.status,toStatus:input.status,
      flagFields:input.flags,version:nextVersion,actorUid:u.uid,actorEmail:u.email||null,
      at:admin.firestore.FieldValue.serverTimestamp()});
    saved={...update,version:nextVersion};
   });
   return res.json({ok:true,message:"Administrative review saved. No payment service activated.",
     review:{status:saved.status,flags:saved.flags,note:saved.note,version:saved.version,updatedBy:saved.updatedByEmail}});
  }
  return bad(res,404,"Not found.");
 }catch(e){
  if(e.code==="MISSING")return bad(res,404,"Application not found.");
  if(e.code==="NO_SUBMISSION")return bad(res,409,"Merchant onboarding form must be submitted first.");
  if(e.code==="CONFLICT")return bad(res,409,"Another staff member updated this review. Refresh before saving.");
  console.error("pilotOnboardingReview failed",{code:String(e.code||"internal")});
  return bad(res,503,"Temporary service error. Try again later.");
 }
});
module.exports._test={validReview,idValid,FLAG_FIELDS};
