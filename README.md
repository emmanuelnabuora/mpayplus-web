# M-Pay+ Firebase Hosting package

This is a static pilot-interest homepage. The lead form is **not connected** to any database, email service, or server. Do not present the form as collecting applications until a backend and privacy notice are added.

## Deploy to the existing Firebase project

1. Install Node.js if needed.
2. Install Firebase CLI: `npm install -g firebase-tools`
3. Log in: `firebase login`
4. Open this directory in a terminal.
5. Confirm the correct existing project in Firebase Console. If its project ID is `m-pay-landing`, run:
   `firebase deploy --only hosting --project m-pay-landing`

If a different project ID is shown, substitute it. Do not deploy to the wrong project.

## Preview locally

Run `firebase emulators:start --only hosting --project m-pay-landing` and open the localhost URL printed by the emulator, or open `public/index.html` in your browser.

## Before public launch

- Connect the pilot form to a secure backend and document data handling in a privacy notice.
- Confirm final domain ownership and DNS settings.
- Review product capabilities, payment flows, pricing, legal and partner claims.
