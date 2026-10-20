"use strict";
// M-Pay+ merchant pilot administration, Phase 2. Admin SDK only; Firestore rules stay deny-all.
const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {handleOperations} = require("./operations");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const {isSiteOrigin} = require("./hosts");
const STATUSES = new Set(["new", "contacted", "screening", "waitlisted", "declined"]);
const ROLES = new Set(["admin", "reviewer"]);
const CHECKLIST = [
  {key:"initial_contact",label:"Initial contact completed"},
  {key:"business_review",label:"Business details reviewed"},
  {key:"pilot_briefing",label:"Pilot briefing completed"},
  {key:"terms_acknowledgement",label:"Pilot terms acknowledged"},
  {key:"demo_walkthrough",label:"Demo walkthrough completed"},
  {key:"readiness_review",label:"Readiness review completed"}
];
const CHECK_KEYS = new Set(CHECKLIST.map(x=>x.key));
const clean = x => typeof x === "string" ? x.trim() : "";
const fail = (res,status,message) => res.status(status).json({ok:false,message});
const iso = d => d?.toDate?.()?.toISOString() || null;
const idOk = value => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const staffLabel = identity => ({actorUid:identity.uid,actorEmail:identity.email||null});
const refFor = id => db.collection("pilotApplications").doc(id);
function baseApplication(doc) {
  const d=doc.data();
  return {
    id:doc.id,fullName:d.fullName||"",business:d.business||"",phone:d.phone||"",city:d.city||"",
    category:d.category||"",payments:d.payments||"",status:d.status||"new",
    assignedTo:d.assignedTo||null,onboarding:d.onboarding||{},
    followUp:d.followUp?{dueDate:d.followUp.dueDate||"",purpose:d.followUp.purpose||"",state:d.followUp.state||"open"}:null,
    verification:{state:d.verification?.state||"not_started"},
    createdAt:iso(d.createdAt),updatedAt:iso(d.updatedAt)
  };
}
function audit(tx,applicationId,action,identity,details={}) {
  const ref=db.collection("pilotAdminAudit").doc();
  tx.create(ref,{applicationId,action,...staffLabel(identity),...details,at:admin.firestore.FieldValue.serverTimestamp()});
}
const parseBody = (req,res,max=2500) => {
  if(!req.is("application/json")){fail(res,415,"JSON required.");return null;}
  const len=Number(req.get("content-length")||0);
  if(!Number.isFinite(len)||len>max){fail(res,413,"Request too large.");return null;}
  if(!req.body||typeof req.body!=="object"||Array.isArray(req.body)){fail(res,400,"Invalid JSON object.");return null;}
  return req.body;
};
exports.pilotAdmin = onRequest({region:"us-central1",timeoutSeconds:20,memory:"256MiB",maxInstances:3,invoker:"public"},async(req,res)=>{
  res.set({"Cache-Control":"no-store, private","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Vary":"Origin"});
  const origin=req.get("Origin");
  if(origin && !isSiteOrigin(origin)) return fail(res,403,"Access denied.");
  if(!["GET","PATCH","POST"].includes(req.method))return fail(res,405,"Method not allowed.");
  const tokenMatch=/^Bearer (\S+)$/.exec(req.get("Authorization")||"");
  if(!tokenMatch)return fail(res,401,"Sign in required.");
  let identity;
  try {identity=await admin.auth().verifyIdToken(tokenMatch[1],true);} catch {return fail(res,401,"Session expired. Sign in again.");}
  const role=identity.mpayRole;
  if(!ROLES.has(role))return fail(res,403,"Staff permission required.");
  const path=req.path.replace(/^\/api\/admin(?=\/|$)/,"")||"/";
  try {
    if(req.method==="GET" && path==="/pilot-applications"){
      const cursor=clean(req.query.cursor);
      if(cursor&&!idOk(cursor))return fail(res,400,"Invalid cursor.");
      const size=50;
      let q=db.collection("pilotApplications").orderBy(admin.firestore.FieldPath.documentId()).limit(size+1);
      if(cursor)q=q.startAfter(cursor);
      const snap=await q.get(), all=snap.docs, page=all.slice(0,size);
      return res.json({ok:true,items:page.map(baseApplication),nextCursor:all.length>size?page[page.length-1].id:null,role});
    }
    const detail=/^\/pilot-applications\/([A-Za-z0-9_-]{1,128})$/.exec(path);
    if(req.method==="GET" && detail){
      const id=detail[1],ref=refFor(id);
      const doc=await ref.get();
      if(!doc.exists)return fail(res,404,"Application not found.");
      const [notesSnap,auditSnap]=await Promise.all([
        ref.collection("notes").orderBy("createdAt","desc").limit(30).get(),
        db.collection("pilotAdminAudit").where("applicationId","==",id).limit(50).get()
      ]);
      const notes=notesSnap.docs.map(n=>({id:n.id,text:n.data().text||"",author:n.data().actorEmail||"Staff",at:iso(n.data().createdAt)}));
      const history=auditSnap.docs.map(x=>{
        const d=x.data();return {id:x.id,action:d.action||"status",from:d.from||null,to:d.to||null,key:d.key||null,
          actor:d.actorEmail||"Staff",at:iso(d.at)};
      }).sort((a,b)=>(b.at||"").localeCompare(a.at||""));
      return res.json({ok:true,application:baseApplication(doc),notes,history,checklist:CHECKLIST,role});
    }
    const phase4 = await handleOperations(req,res,{path,identity,role,db,admin,refFor,parseBody,audit,fail});
    if(phase4!==null)return phase4;
    const actionRoute=/^\/pilot-applications\/([A-Za-z0-9_-]{1,128})\/(status|assignment|checklist|notes)$/.exec(path);
    if(!actionRoute)return fail(res,404,"Not found.");
    const [,id,action]=actionRoute;
    if(role!=="admin")return fail(res,403,"Only admins may modify applications.");
    if((action==="notes"?"POST":"PATCH")!==req.method)return fail(res,405,"Method not allowed.");
    const body=parseBody(req,res);if(!body)return;
    const ref=refFor(id);
    if(action==="status"){
      const status=clean(body.status);
      if(!STATUSES.has(status))return fail(res,400,"Invalid status.");
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref);
        if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
        const previous=current.data().status||"new";
        if(previous===status)return;
        tx.update(ref,{status,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:identity.uid});
        audit(tx,id,"status",identity,{from:previous,to:status});
      });
      return res.json({ok:true,id,status});
    }
    if(action==="assignment"){
      const email=clean(body.assigneeEmail).toLowerCase();
      if(email.length>254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return fail(res,400,"Enter a valid staff email or clear to unassign.");
      let target=null;
      if(email){
        let user;
        try{user=await admin.auth().getUserByEmail(email);}catch(e){if(e.code==="auth/user-not-found")return fail(res,400,"Staff account not found.");throw e;}
        if(user.disabled || !ROLES.has(user.customClaims?.mpayRole))return fail(res,400,"Assignee must be an active provisioned staff member.");
        target={uid:user.uid,email:user.email};
      }
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref);
        if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
        const old=current.data().assignedTo||null;
        if((old?.uid||null)===(target?.uid||null))return;
        tx.update(ref,{assignedTo:target,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:identity.uid});
        audit(tx,id,"assignment",identity,{from:old?.email||null,to:target?.email||null});
      });
      return res.json({ok:true,assignedTo:target});
    }
    if(action==="checklist"){
      const key=clean(body.key);
      if(!CHECK_KEYS.has(key) || typeof body.completed!=="boolean")return fail(res,400,"Invalid checklist item.");
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref);
        if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
        const old=current.data().onboarding?.[key]?.completed===true;
        if(old===body.completed)return;
        tx.update(ref,{[`onboarding.${key}`]:{completed:body.completed,by:identity.uid,at:admin.firestore.Timestamp.now()},
          updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:identity.uid});
        audit(tx,id,"checklist",identity,{key,from:String(old),to:String(body.completed)});
      });
      return res.json({ok:true,key,completed:body.completed});
    }
    if(action==="notes"){
      const note=clean(body.text);
      if(note.length<3||note.length>1000 || /[\u0000-\u0008\u000e-\u001f]/.test(note))return fail(res,400,"Note must contain 3–1000 readable characters.");
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref);
        if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
        const noteRef=ref.collection("notes").doc();
        tx.create(noteRef,{text:note,...staffLabel(identity),createdAt:admin.firestore.FieldValue.serverTimestamp()});
        tx.update(ref,{updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:identity.uid});
        audit(tx,id,"note",identity,{noteId:noteRef.id}); // Never copy note text into global audit.
      });
      return res.json({ok:true,message:"Internal note saved."});
    }
  }catch(e){
    if(e.code==="NOT_FOUND")return fail(res,404,"Application not found.");
    if(e.code==="NO_OPEN_FOLLOWUP")return fail(res,409,"No open follow-up to complete.");
    console.error("pilotAdmin failure",{code:e.code||"internal"}); // No PII / tokens in logs.
    return fail(res,503,"Temporary service error.");
  }
});
