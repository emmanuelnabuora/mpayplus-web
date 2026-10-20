"use strict";
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");

admin.initializeApp();
const db = admin.firestore();
const turnstileSecret = defineSecret("TURNSTILE_SECRET");
const allowedOrigin = "https://m-pay-landing.web.app";
const fields = ["fullName", "business", "phone", "city", "category", "payments"];
const categories = new Set(["Retail / supermarket","Market stall","Restaurant / café","Services","Other"]);
const methods = new Set(["Lipa na M-Pesa Till","Pochi la Biashara","M-Pesa phone number","Cash","Bank card / POS"]);
const clean = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const bad = (res,code,message) => res.status(code).json({ok:false,message});

exports.pilotSignup = onRequest({
  region:"us-central1", timeoutSeconds:20, memory:"256MiB", maxInstances:5,
  secrets:[turnstileSecret], invoker:"public"
}, async (req,res) => {
  res.set("Cache-Control","no-store");
  res.set("X-Content-Type-Options","nosniff");
  if(req.method!=="POST") return bad(res,405,"Method not allowed.");
  if(req.get("Origin") !== allowedOrigin) return bad(res,403,"Submit from the official website.");
  if(!req.is("application/json")) return bad(res,415,"JSON required.");
  if(Number(req.get("Content-Length")||0)>10000) return bad(res,413,"Request too large.");
  const body = req.body;
  if(!body || typeof body!=="object" || Array.isArray(body)) return bad(res,400,"Invalid form.");
  // Honeypot field: don't store bot traffic.
  if(clean(body.website)) return res.status(200).json({ok:true,message:"Thanks for your interest."});
  const data=Object.fromEntries(fields.map(k=>[k,clean(body[k])]));
  if(!fields.every(k=>data[k] && data[k].length<=120) || data.fullName.length<2 || data.business.length<2 ||
     !/^\+?[0-9 ()-]{9,20}$/.test(data.phone) || !categories.has(data.category) || !methods.has(data.payments) ||
     body.consent!==true) return bad(res,400,"Please complete all fields and consent to contact.");
  const token=clean(body.turnstileToken);
  if(!token || token.length>2048) return bad(res,400,"Complete the security check and retry.");
  const secret=turnstileSecret.value();
  if(!secret) return bad(res,503,"Registration is not yet configured.");
  try {
    const clientIp=(req.get("x-forwarded-for")||"").split(",")[0].trim() || req.ip || "unknown";
    const result=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({secret,response:token,remoteip:clientIp}),signal:AbortSignal.timeout(6500)
    });
    if(!result.ok) {
      const errorBody = await result.json().catch(() => ({}));
        console.error("Turnstile verification rejected", {
          status: result.status,
          errorCodes: errorBody["error-codes"] || [],
          secretLength: secret.length
        });
      return bad(res,503,"Security verification unavailable. Try again later.");
    }
    const verified=await result.json();
    if(!verified.success || verified.hostname!=="m-pay-landing.web.app") return bad(res,403,"Security verification failed. Please retry.");
    const phone=data.phone.replace(/\D/g, "");
    const day=new Date().toISOString().slice(0,10);
    const hashed=(key)=>crypto.createHmac("sha256",secret).update(key).digest("hex");
    const ipRef=db.collection("pilotRateLimits").doc("ip_"+hashed(`${day}:${clientIp}`));
    const phoneRef=db.collection("pilotRateLimits").doc("phone_"+hashed(`${day}:${phone}`));
    const appRef=db.collection("pilotApplications").doc();
    // One transaction: enforce per-IP and per-phone daily limits and store submission atomically.
    await db.runTransaction(async tx=>{
      const [ipSnap,phoneSnap]=await Promise.all([tx.get(ipRef),tx.get(phoneRef)]);
      if((ipSnap.data()?.count||0)>=5 || (phoneSnap.data()?.count||0)>=2) {
        const error=new Error("Too many submissions. Please try another day.");error.code="RATE_LIMIT";throw error;
      }
      const expireAt=admin.firestore.Timestamp.fromDate(new Date(Date.now()+3*86400000));
      tx.set(ipRef,{count:(ipSnap.data()?.count||0)+1,expireAt},{merge:true});
      tx.set(phoneRef,{count:(phoneSnap.data()?.count||0)+1,expireAt},{merge:true});
      tx.create(appRef,{...data,phoneNormalized:phone,consent:true,consentTextVersion:"2026-10-12",status:"new",source:"landing-page",createdAt:admin.firestore.FieldValue.serverTimestamp()});
    });
    return res.status(201).json({ok:true,message:"Thank you. Your pilot interest has been received."});
  } catch(err) {
    if(err.code==="RATE_LIMIT") return bad(res,429,err.message);
    console.error("Pilot signup error",{code:err.code||"internal"});
    return bad(res,503,"Unable to submit right now. Please try again later.");
  }
});

Object.assign(exports, require("./admin"));

exports.merchantOnboarding = require("./onboarding").merchantOnboarding;

exports.pilotOnboardingReview = require("./review").pilotOnboardingReview;
exports.merchantCorrections = require("./corrections").merchantCorrections;
exports.pilotMerchantReadiness = require("./readiness").pilotMerchantReadiness;
