# Firebase Authentication Setup Guide

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter project name: `tdis-logistics`
4. Disable Google Analytics (optional)
5. Click "Create project"

## Step 2: Set Up Authentication

1. In Firebase Console, go to **Authentication** → **Get started**
2. Click on "Email/Password"
3. Enable it and click "Save"

## Step 3: Create Firestore Database

1. Go to **Firestore Database** → **Create database**
2. Choose **Start in test mode** (for development)
3. Select region closest to you
4. Click "Create"

## Step 4: Get Your Firebase Credentials

1. Go to **Project Settings** (gear icon)
2. Scroll to "Your apps"
3. Click "Add app" → choose **Web** (</> icon)
4. Register app with name "TDIS Dashboard"
5. Copy the config object that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "tdis-logistics",
  storageBucket: "tdis-logistics.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## Step 5: Update Your HTML File

1. Open `index.html`
2. Find the Firebase config (around line 1548)
3. Replace the placeholder values with your actual credentials from Step 4

## Step 6: Create Default Users in Firestore

### Option A: Manual Creation (via Firebase Console)

1. In Firestore, create a new collection called **users**
2. Add these documents:

**Document ID:** `admin@tdis.com`
```json
{
  "name": "Admin User",
  "email": "admin@tdis.com",
  "role": "admin",
  "permissions": ["view_all", "manage_users", "manage_balances", "view_analytics", "edit_clients", "delete_bookings"],
  "status": "active",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Document ID:** `agent@tdis.com`
```json
{
  "name": "Agent User",
  "email": "agent@tdis.com",
  "role": "staff",
  "permissions": ["view_balances", "update_bookings", "manage_clients"],
  "status": "active",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### Option B: Create Users via Auth Console

1. Go to **Authentication** → **Users** tab
2. Click **Add user**
3. Create users:
   - **Email:** admin@tdis.com | **Password:** demo123456
   - **Email:** agent@tdis.com | **Password:** demo123456

4. Then manually add the Firestore documents as shown in Option A

## Step 7: Enable Real-time Sync (Important!)

1. Go to **Firestore Database** → **Rules**
2. Replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow users to read/write their own data and shared data
    match /users/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /clients/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /bookings/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. Click **Publish**

## Step 8: Test Login

1. Open your HTML file in a browser
2. You should see the Firebase login screen
3. Sign up with a new account OR use:
   - **Email:** admin@tdis.com
   - **Password:** demo123456

## Default Test Accounts

After setup, you can use these credentials:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@tdis.com | demo123456 |
| Agent | agent@tdis.com | demo123456 |

## Important Security Notes ⚠️

- **DO NOT** push your Firebase config to GitHub
- **DO NOT** use test mode rules in production
- Change password from `demo123456` in production
- Use environment variables for sensitive data in production
- Enable CORS properly for your domain

## Troubleshooting

### "Firebase is not defined"
- Make sure Firebase SDK scripts are loading in head
- Check browser console for 404 errors

### "auth.signInWithEmailAndPassword is not a function"
- Verify Firebase SDK version (should be 10.7.0 or later)

### Firestore data not syncing
- Check browser console for errors
- Verify Firestore rules allow your user to read/write
- Check if user UID matches document ID in some cases

### Can't create account
- Ensure email format is valid
- Password must be at least 6 characters
- Check Firestore quota limits

## Need Help?

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firebase Auth Guide](https://firebase.google.com/docs/auth)
- [Firestore Setup Guide](https://firebase.google.com/docs/firestore)
