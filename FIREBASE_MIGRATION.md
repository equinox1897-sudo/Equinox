# Watchers Eye - Firebase Migration Guide

This project has been migrated from SQLite to Firebase Firestore. This document explains the changes and how to deploy to Firebase.

## What Changed

### Database Migration
- **From**: SQLite (local file-based database)
- **To**: Firestore (cloud NoSQL database)

### Key Changes
1. **Removed**: `sqlite3` dependency
2. **Added**: `firebase-admin` SDK
3. **Created**: New `firestore.js` module for database initialization
4. **Updated**: All SQL queries converted to Firestore NoSQL operations
5. **Removed**: SQLite admin UI endpoints (`/sqlite`, `/api/sqlite/*`)
6. **Backup**: Original SQLite server saved as `server-sqlite-backup.js`

### Collections Structure
The following Firestore collections are used:

- **users**: User profiles (uid, email, name, created_at)
- **user_auth**: Authentication data (uid, email, password_hash, created_at)
- **balances**: User balances (uid, balance_usd, wallet_balance_usd, updated_at)
- **deposits**: Deposit/withdrawal transactions (uid, amount_usd, note, created_at)
- **stocks**: Stock data (company, current_price, percentage_change, direction, updated_at)
- **user_percentages**: Percentage bubbles per user (uid, value, direction, updated_at)

## Firebase Setup

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable Firestore Database in the Firebase console
4. Enable Firebase Functions

### 2. Install Firebase CLI
```powershell
npm install -g firebase-tools
```

### 3. Login to Firebase
```powershell
firebase login
```

### 4. Initialize Firebase in Your Project
```powershell
cd C:\Users\HP\Documents\angular\equinox\Equinox
firebase init
```

Select:
- Firestore
- Functions
- Hosting

When prompted:
- Use existing project (select your Firebase project)
- Accept default Firestore rules file: `firestore.rules`
- Accept default Firestore indexes file: `firestore.indexes.json`
- Choose `functions` as your functions directory
- Choose JavaScript (or TypeScript if you prefer)
- Use ESLint? No (or Yes if you want)
- Install dependencies? Yes
- Public directory: `.` (current directory)
- Configure as single-page app? No
- Set up automatic builds? No

### 5. Update .firebaserc
Edit `.firebaserc` and replace `your-project-id` with your actual Firebase project ID:

```json
{
  "projects": {
    "default": "your-actual-project-id"
  }
}
```

### 6. Get Firebase Service Account Key

#### For Local Development:
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Save the JSON file as `serviceAccountKey.json` in your project root
4. **IMPORTANT**: Add `serviceAccountKey.json` to `.gitignore` to avoid committing secrets

#### For Production (Firebase Hosting):
Firebase Functions automatically have access to your Firestore when deployed. No manual credentials needed.

### 7. Configure Environment Variables

Create a `.env` file in your project root:

```env
# Email Configuration
SMTP_HOST=mail.privateemail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-mailbox@vault-x.site
SMTP_PASS=your_smtp_password

# Admin Key
ADMIN_KEY=1738

# Firebase Service Account (local development only)
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json

# CORS Origins (optional)
CORS_ORIGINS=https://your-project-id.web.app,https://your-project-id.firebaseapp.com
```

## Running Locally

### Option 1: Run Standalone Server (for testing)
```powershell
# Set environment variables
$env:FIREBASE_SERVICE_ACCOUNT_PATH='./serviceAccountKey.json'

# Start server
npm start
```

Server will run at `http://localhost:3001`

### Option 2: Run Firebase Emulators
```powershell
# Install functions dependencies
cd functions
npm install
cd ..

# Start Firebase emulators
firebase emulators:start
```

This will run:
- Functions emulator
- Firestore emulator
- Hosting emulator

## Deployment to Firebase

### 1. Install Functions Dependencies
```powershell
cd functions
npm install
cd ..
```

### 2. Deploy Firestore Rules and Indexes
```powershell
firebase deploy --only firestore
```

### 3. Deploy Functions
```powershell
firebase deploy --only functions
```

### 4. Deploy Hosting (Static Files)
```powershell
firebase deploy --only hosting
```

### 5. Deploy Everything
```powershell
firebase deploy
```

Your app will be available at:
- `https://your-project-id.web.app`
- `https://your-project-id.firebaseapp.com`

## API Endpoints

All API endpoints remain the same, but are now served through Firebase Functions:

### Authentication
- `POST /api/signup` - Create new user
- `POST /api/login` - User login
- `POST /api/register` - Legacy registration endpoint

### Users
- `GET /api/users` - Get all users (admin only)
- `GET /api/profile/:uid` - Get user profile

### Deposits
- `POST /api/deposits/manual` - Manual deposit (admin only)
- `POST /api/deposits/manual/home` - Home balance deposit (admin only)
- `GET /api/deposits/:uid` - List user deposits

### Transactions
- `POST /api/withdraw` - Withdraw funds

### Stocks
- `GET /api/stocks` - Get all stocks
- `POST /api/stocks/update-percentage` - Update stock (admin only)

### Percentages
- `GET /api/percentage/current` - Get current percentage
- `POST /api/percentage/update` - Update percentage (admin only)

## Security Notes

1. **Firestore Rules**: The `firestore.rules` file controls database access. Current rules allow:
   - Server-side only access for user_auth, balances, deposits
   - Public read for stocks
   - Authenticated read for users

2. **Admin Key**: Change the default `ADMIN_KEY` in production

3. **Service Account**: Never commit `serviceAccountKey.json` to git

4. **CORS**: Configure allowed origins in `.env` for production

## Troubleshooting

### "Firebase Admin not initialized" Error
- Make sure `FIREBASE_SERVICE_ACCOUNT_PATH` is set correctly
- Verify the service account JSON file exists
- Check file permissions

### "Collection not found" Errors
- Firestore creates collections automatically on first write
- Run signup/login to populate initial data
- Check Firestore console for existing data

### Function Deployment Errors
- Ensure you're in the project root when deploying
- Check `functions/package.json` has all dependencies
- Run `npm install` in `functions/` directory

### CORS Errors
- Update `CORS_ORIGINS` in `.env`
- Redeploy functions after changing environment variables

## Data Migration from SQLite

If you have existing SQLite data to migrate:

1. Export data from SQLite database
2. Create a migration script using the Firestore Admin SDK
3. Import data into corresponding Firestore collections
4. Verify data integrity

Example migration script structure:
```javascript
import db from './firestore.js';
import sqlite3 from 'sqlite3';

// Read from SQLite
// Write to Firestore using db.collection().doc().set()
```

## Firebase Console URLs

- Project Overview: `https://console.firebase.google.com/project/your-project-id`
- Firestore Database: `https://console.firebase.google.com/project/your-project-id/firestore`
- Functions: `https://console.firebase.google.com/project/your-project-id/functions`
- Hosting: `https://console.firebase.google.com/project/your-project-id/hosting`

## Support

For Firebase-specific issues, consult:
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Cloud Functions Documentation](https://firebase.google.com/docs/functions)

## License

Same as original project.
