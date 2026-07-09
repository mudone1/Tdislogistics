# Firebase Setup Guide (Next.js version)

This app talks to Firebase the same way the original HTML app did — one
Firestore document per "collection" (`tdis_data/balances`, `tdis_data/clients`,
etc.) plus optional Firebase Auth — but credentials now come from environment
variables instead of being hard-coded in the page source.

**The app works fully without Firebase too.** If you don't configure it,
everything falls back to browser `localStorage` — single device, no
cross-device sync, but nothing crashes and no page is disabled.

## Step 1: Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Click "Add project" → name it (e.g. `tdis-logistics`) → create it

## Step 2: Enable Authentication (optional but recommended)

1. **Authentication** → **Get started** → enable **Email/Password**

## Step 3: Create a Firestore database

1. **Firestore Database** → **Create database**
2. Start in **test mode** for local development (tighten rules before going live — see Step 6)

## Step 4: Get your web app credentials

1. **Project Settings** (gear icon) → scroll to "Your apps" → **Add app** → **Web**
2. Register it (any nickname), then copy the config values shown

## Step 5: Fill in your local env file

Copy `.env.local.example` to `.env.local` in the project root and paste in
the values from Step 4:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tdis-logistics
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tdis-logistics.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Restart `npm run dev` after editing `.env.local` — Next.js only reads env
files at startup.

On Vercel/Netlify/etc, add the same variables in your project's
Environment Variables settings (they must be prefixed `NEXT_PUBLIC_` to be
readable in the browser, which is why they're named that way).

## Step 6: Lock down Firestore rules before going live

Test-mode rules allow anyone to read/write. Before real data goes in,
go to **Firestore Database → Rules** and use something like:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tdis_data/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Then **Publish**.

## Default sign-in for first login

The app ships with two built-in local accounts so you can log in before any
Firebase user exists:

| Role  | Email           | Password  |
|-------|-----------------|-----------|
| Admin | admin@tdis.com  | admin123  |
| Agent | agent@tdis.com  | agent123  |

**Change or remove these before going live** — they're defined in
`src/lib/constants.ts` (`LOCAL_CREDENTIALS`).

## Troubleshooting

- **Data not syncing across devices** — check `.env.local` is filled in and
  the dev server was restarted; open the browser console for `[firebase]`
  warnings.
- **"Firebase not configured" in console** — expected if you haven't set the
  env vars yet; the app is deliberately running in local-only mode.
- **Firestore permission-denied errors** — your security rules don't allow
  the current auth state to read/write `tdis_data/*`; see Step 6.
