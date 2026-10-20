"use strict";
// Run in Cloud Shell using Google Application Default Credentials after provisioning
// the staff account in Firebase Authentication. Never run this on a public server.
const admin = require("firebase-admin");
if(!admin.apps.length)admin.initializeApp({projectId:"m-pay-landing"});
(async()=>{
  const [email,role]=process.argv.slice(2);
  if(!email || !["admin","reviewer"].includes(role)) {
    console.error("Usage: node grant-staff-role.js person@example.com admin|reviewer");process.exit(2);
  }
  const user=await admin.auth().getUserByEmail(email);
  const existing=user.customClaims||{};
  await admin.auth().setCustomUserClaims(user.uid,{...existing,mpayRole:role});
  console.log(`Assigned M-Pay+ ${role} role to ${email}. Reauthentication required.`);
})().catch(e=>{console.error("Unable to set role:",e.code||e.message);process.exit(1)});
