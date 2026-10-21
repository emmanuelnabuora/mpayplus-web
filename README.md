# M-Pay+ pilot registration on Firebase

Includes a modified static homepage, a server-side Cloud Function (`pilotSignup`), locked-down Firestore rules, a pilot privacy notice, anti-bot Turnstile validation, and rate limiting.

## Prerequisites
- Your Firebase project is `m-pay-landing`. Cloud Functions 2nd gen require an eligible billing-enabled (Blaze) project. Charges may apply.
- Firebase Firestore database created in **Native mode**. Choose region carefully before creating; it cannot easily be changed.
- Cloudflare Turnstile configured for hostname `m-pay-landing.web.app`, with a site key and secret key.
- Firebase CLI already present in Cloud Shell.

## Set up
1. Upload this ZIP to Google Cloud Shell and unzip it.
2. `cd ~/mpay-registration/M-Pay-Plus-Pilot-Registration` (adjust if your ZIP extracted elsewhere).
3. In `public/index.html`, replace `REPLACE_WITH_YOUR_TURNSTILE_SITE_KEY` with your Turnstile *public site key*. Never place the secret there.
4. `firebase functions:secrets:set TURNSTILE_SECRET --project m-pay-landing` and paste the Turnstile *secret* when prompted.
5. `cd functions && npm install && cd ..`
6. `firebase deploy --only functions,firestore:rules,hosting --project m-pay-landing`
7. Test in the website: submit a pilot interest form; confirm collection `pilotApplications` in Firestore.

**IMPORTANT** Do not deploy until you are ready to replace the current hosted landing page.

## Operational notes
- Firestore rules DENY ALL client database reads/writes. Server SDK uses IAM privileges to save form submissions.
- Restrict access to Firebase Console and service accounts. Review roles/permissions.
- Rate limit: 5 submissions/IP/day and 2/phone/day; counters are retained unless you configure a Firestore TTL policy for `pilotRateLimits.expireAt`.
- The functions accept requests only from the hostnames listed in `functions/hosts.js`: `m-pay-landing.web.app`, `mpayplus.co.ke` and `www.mpayplus.co.ke`. The Turnstile widget in Cloudflare must list the same hostnames. To add another domain, add it in both places before deploying.
- Invite and correction links sent to merchants still use `https://m-pay-landing.web.app` (`HOME` in `functions/onboarding.js` and `functions/corrections.js`). Switch them to `https://mpayplus.co.ke` once that domain shows Connected in Firebase Hosting.
- This package does **not** include a staff dashboard or payment processing. Review the privacy notice with your counsel before accepting live personal data.
- Confirm `contact@mpayplus.co.ke` is an active monitored inbox.
- If the form doesn't submit, check Cloud Functions logs for `pilotSignup` and Turnstile hostname/site key/secret alignment.
