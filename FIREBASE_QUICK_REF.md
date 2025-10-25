# 🚀 Firebase Quick Reference Card

## Your Project
**ID**: equinox-b1604  
**URL**: https://equinox-b1604.web.app

## Quick Commands

### Deploy Everything
```powershell
firebase deploy
```

### Deploy Specific Services
```powershell
firebase deploy --only hosting    # Static files
firebase deploy --only functions  # API endpoints
firebase deploy --only firestore  # Database rules
```

### Local Testing
```powershell
# Backend server
$env:FIREBASE_SERVICE_ACCOUNT_PATH='./serviceAccountKey.json'
npm start

# Firebase emulators
firebase emulators:start
```

### View Logs
```powershell
firebase functions:log
```

## Firebase Console Quick Links

- **🏠 Dashboard**: https://console.firebase.google.com/project/equinox-b1604
- **💾 Firestore**: https://console.firebase.google.com/project/equinox-b1604/firestore
- **⚡ Functions**: https://console.firebase.google.com/project/equinox-b1604/functions
- **🌐 Hosting**: https://console.firebase.google.com/project/equinox-b1604/hosting
- **📊 Analytics**: https://console.firebase.google.com/project/equinox-b1604/analytics
- **🔑 Service Accounts**: https://console.firebase.google.com/project/equinox-b1604/settings/serviceaccounts

## API Endpoints

All endpoints work with `/api/` prefix:

### Authentication
- `POST /api/signup` - Create account
- `POST /api/login` - Sign in

### Users
- `GET /api/users` - All users (admin)
- `GET /api/profile/:uid` - User profile

### Deposits & Transactions
- `POST /api/deposits/manual` - Gas deposit (admin)
- `POST /api/deposits/manual/home` - Home deposit (admin)
- `GET /api/deposits/:uid` - Transaction history
- `POST /api/withdraw` - Withdraw funds

### Stocks
- `GET /api/stocks` - Get all stocks
- `POST /api/stocks/update-percentage` - Update stock (admin)

### Percentages
- `GET /api/percentage/current` - Current percentage
- `POST /api/percentage/update` - Update percentage (admin)

## Firebase SDK Snippet

Add to any HTML `<head>`:

```html
<script type="module">
  import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
  import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';
  
  const firebaseConfig = {
    apiKey: "AIzaSyD1cH55nyjNRcpXnWCgEBHKsutYTnLbQt8",
    authDomain: "equinox-b1604.firebaseapp.com",
    projectId: "equinox-b1604",
    storageBucket: "equinox-b1604.firebasestorage.app",
    messagingSenderId: "752173466191",
    appId: "1:752173466191:web:6da85b3e6c0aa86527e03a",
    measurementId: "G-75PH8JT8R5"
  };

  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
  window.firebaseApp = app;
  window.firebaseAnalytics = analytics;
</script>
```

## Track Analytics Events

```javascript
import { logEvent } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';

logEvent(window.firebaseAnalytics, 'event_name', { param: 'value' });
```

## Environment Variables

`.env` file:
```env
ADMIN_KEY=1738
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
SMTP_HOST=mail.privateemail.com
SMTP_PORT=587
SMTP_USER=your-mailbox@vault-x.site
SMTP_PASS=your_password
```

## Firestore Collections

- **users** - User profiles
- **user_auth** - Passwords (server-only)
- **balances** - User balances
- **deposits** - Transaction history
- **stocks** - Stock data
- **user_percentages** - Percentage bubbles

## Files You Need

✅ Already created:
- `firebase.json`
- `.firebaserc`
- `firestore.rules`
- `firestore.indexes.json`
- `functions/index.js`
- `functions/package.json`

❗ You need to create:
- `serviceAccountKey.json` (download from Firebase Console)
- `.env` (copy from `env.example`)

## Deployment Checklist

1. ✅ Firebase project created (equinox-b1604)
2. ⬜ Downloaded service account key
3. ⬜ Created `.env` file
4. ⬜ Tested locally
5. ⬜ Installed functions dependencies (`cd functions && npm install`)
6. ⬜ Deployed to Firebase (`firebase deploy`)

## Common Issues

**"Firebase Admin not initialized"**
→ Set `FIREBASE_SERVICE_ACCOUNT_PATH` in .env

**"Collection not found"**
→ Firestore creates collections on first write. Use the app to create data.

**CORS errors in production**
→ Add your domain to `CORS_ORIGINS` and redeploy functions

**Functions not working**
→ Check logs: `firebase functions:log`

## Support

- 📖 Docs: See `FIREBASE_CLIENT_SDK.md`
- 📖 Migration: See `FIREBASE_MIGRATION.md`
- 🆘 Firebase Docs: https://firebase.google.com/docs

---

**Project Status**: ✅ Fully migrated to Firebase & ready to deploy!
