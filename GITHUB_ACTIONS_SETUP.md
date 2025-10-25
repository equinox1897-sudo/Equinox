# GitHub Actions CI/CD Setup for Firebase

## ✅ What's Been Done

1. Created `.github/workflows/firebase-deploy.yml` - GitHub Actions workflow
2. Generated Firebase CI token (stored locally - see below for setup)

## 🔧 What You Need to Do

### Step 1: Add Secrets to GitHub Repository

Go to your GitHub repository: https://github.com/equinox1897-sudo/Equinox

1. Click **Settings** tab
2. Click **Secrets and variables** → **Actions** (in left sidebar)
3. Click **New repository secret**

#### Add these TWO secrets:

**Secret 1: FIREBASE_TOKEN**
- Name: `FIREBASE_TOKEN`
- Value: Run `firebase login:ci` in your terminal to generate a new token, then copy it here

**Secret 2: FIREBASE_SERVICE_ACCOUNT**
- Name: `FIREBASE_SERVICE_ACCOUNT`
- Value: Copy the entire contents of your local `serviceAccountKey.json` file (do NOT commit this file to Git)

### Step 2: Push Your Code to GitHub

After adding the secrets, commit and push your code:

```powershell
git add .
git commit -m "Add GitHub Actions CI/CD for Firebase deployment"
git push origin main
```

### Step 3: Watch It Deploy!

1. Go to https://github.com/equinox1897-sudo/Equinox/actions
2. You'll see the "Deploy to Firebase" workflow running
3. Click on it to watch the progress live
4. When complete, your site will be deployed to https://equinox-b1604.web.app

## 🎯 How It Works

The workflow triggers on:
- **Every push to `main` branch** - Automatic deployment
- **Manual trigger** - You can click "Run workflow" in GitHub Actions tab

It will:
1. ✅ Install dependencies (root and functions)
2. ✅ Deploy static files to Firebase Hosting
3. ✅ Deploy Firestore rules and indexes
4. ✅ Deploy Functions (if on Blaze plan, otherwise skips gracefully)

## 📋 Manual Deployment Commands

You can still deploy manually anytime:

```powershell
# Deploy everything
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore

# Deploy only Functions (requires Blaze plan)
firebase deploy --only functions
```

## 🔍 Monitoring

- **GitHub Actions**: https://github.com/equinox1897-sudo/Equinox/actions
- **Firebase Console**: https://console.firebase.google.com/project/equinox-b1604
- **Live Site**: https://equinox-b1604.web.app

## ⚠️ Important Notes

1. The workflow will **NOT fail** if Functions deployment fails (Spark plan limitation)
2. Secrets are encrypted in GitHub - only the workflow can access them
3. Every push to `main` triggers deployment - be careful with direct commits
4. You can create a `dev` branch for testing and only merge to `main` when ready to deploy

## 🚀 Best Practices

1. **Create a dev branch for development:**
   ```powershell
   git checkout -b dev
   # Make changes, test locally
   git add .
   git commit -m "Your changes"
   git push origin dev
   ```

2. **Merge to main when ready to deploy:**
   ```powershell
   git checkout main
   git merge dev
   git push origin main  # This triggers deployment!
   ```

3. **Use Pull Requests** for code review before deployment

## 🔧 Troubleshooting

**If deployment fails:**
1. Check the Actions tab for error logs
2. Verify secrets are correctly set in repository settings
3. Ensure Firebase project has billing enabled (for Functions)

**If Functions don't deploy:**
- This is expected on Spark plan
- Upgrade to Blaze plan: https://console.firebase.google.com/project/equinox-b1604/usage/details

**If Firestore rules fail:**
- Check firestore.rules syntax in Firebase Console
- Ensure indexes are properly defined in firestore.indexes.json
