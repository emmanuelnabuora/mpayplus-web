"use strict";
// Phase 4 merchant follow-up and business-review metadata. No identity documents,
// payment keys, settlement accounts or compliance approvals are stored or processed.
const VERIFICATION_STATES = new Set([
  "not_started", "documents_requested", "under_review", "reviewed", "needs_clarification"
]);
const EAT_DAY = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Africa/Nairobi",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const val = kind => parts.find(x=>x.type===kind).value;
  return `${val("year")}-${val("month")}-${val("day")}`;
};
const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s+"T00:00:00Z")) &&
  new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
const clean = v => typeof v==="string"?v.trim():"";
const BAD_CHARS = /[\u0000-\u001f\u007f]/;
// This handler executes only inside pilotAdmin AFTER Firebase Auth / mpayRole checks.
// Returns null for unrecognized paths; otherwise sends a response.
async function handleOperations(req,res,{path,identity,role,db,admin,refFor,parseBody,audit,fail}) {
  const m=/^\/pilot-applications\/([A-Za-z0-9_-]{1,128})\/(follow-up|follow-up\/complete|verification)$/.exec(path);
  if(!m)return null;
  if(role!=="admin")return fail(res,403,"Only admins may modify merchant operations.");
  const [,id,operation]=m;
  const expected=operation==="follow-up/complete"?"POST":"PATCH";
  if(req.method!==expected)return fail(res,405,"Method not allowed.");
  const body=parseBody(req,res,1000);
  if(!body)return res;
  const ref=refFor(id), FieldValue=admin.firestore.FieldValue;
  if(operation==="follow-up"){
    const dueDate=clean(body.dueDate), purpose=clean(body.purpose);
    const day=EAT_DAY(), maxDay=new Date(Date.parse(day+"T00:00:00Z")+366*86400000).toISOString().slice(0,10);
    if(!validDay(dueDate)||dueDate<day||dueDate>maxDay || purpose.length<3 || purpose.length>120 || BAD_CHARS.test(purpose))
      return fail(res,400,"Choose a valid follow-up date within the next 12 months and a short purpose (3–120 characters).");
    await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
      const prev=current.data().followUp||null;
      if(prev?.state==="open" && prev?.dueDate===dueDate && prev?.purpose===purpose)return;
      tx.update(ref,{followUp:{dueDate,purpose,state:"open",updatedBy:identity.uid,updatedAt:FieldValue.serverTimestamp()},
        updatedAt:FieldValue.serverTimestamp(),updatedBy:identity.uid});
      audit(tx,id,"followup_scheduled",identity,{from:prev?.dueDate||null,to:dueDate});
    });
    return res.json({ok:true,dueDate,state:"open"});
  }
  if(operation==="follow-up/complete"){
    await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
      const prev=current.data().followUp;
      if(!prev||prev.state!=="open"){
        const e=new Error("NO_OPEN_FOLLOWUP");e.code="NO_OPEN_FOLLOWUP";throw e;
      }
      tx.update(ref,{"followUp.state":"completed","followUp.completedAt":FieldValue.serverTimestamp(),
        "followUp.completedBy":identity.uid,updatedAt:FieldValue.serverTimestamp(),updatedBy:identity.uid});
      audit(tx,id,"followup_completed",identity,{key:prev.dueDate||null});
    });
    return res.json({ok:true,state:"completed"});
  }
  const state=clean(body.state);
  if(!VERIFICATION_STATES.has(state))return fail(res,400,"Invalid review state.");
  await db.runTransaction(async tx=>{
    const current=await tx.get(ref);
    if(!current.exists){const e=new Error("NOT_FOUND");e.code="NOT_FOUND";throw e;}
    const prev=current.data().verification?.state||"not_started";
    if(prev===state)return;
    tx.update(ref,{verification:{state,updatedBy:identity.uid,updatedAt:FieldValue.serverTimestamp()},
      updatedAt:FieldValue.serverTimestamp(),updatedBy:identity.uid});
    audit(tx,id,"verification_review",identity,{from:prev,to:state});
  });
  return res.json({ok:true,state});
}
module.exports={handleOperations,VERIFICATION_STATES,validDay};
