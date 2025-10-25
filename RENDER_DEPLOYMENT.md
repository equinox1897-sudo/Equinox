# Render Deployment Guide

## Environment Variables Required

### Required Variables (Set in Render Dashboard)

1. **DATABASE_URL** - Automatically provided by Render PostgreSQL database
2. **ADMIN_KEY** - Secret key for admin operations (generate a secure random string)
3. **NODE_ENV** - Set to `production`

### Optional Variables (Configure as needed)

4. **CORS_ORIGINS** - Comma-separated list of allowed origins (e.g., `https://yourdomain.com,https://www.yourdomain.com`)
5. **EMAIL_HOST** - SMTP server hostname (e.g., `smtp.gmail.com`)
6. **EMAIL_PORT** - SMTP port (e.g., `587`)
7. **EMAIL_USER** - SMTP username
8. **EMAIL_PASS** - SMTP password or app password

## Deployment Steps

### 1. Create Render Account
- Sign up at [render.com](https://render.com)
- Connect your GitHub repository

### 2. Database Configuration
Your database is already configured:
- **Database**: `watchers_eye_db`
- **Host**: `dpg-d3pkt7ili9vc73blnkn0-a`
- **User**: `watchers_eye_db_user`
- **Connection String**: Already provided in render.yaml

### 3. Deploy Web Service
- In Render Dashboard, go to "Web Services"
- Click "New +" → "Web Service"
- Connect your GitHub repository
- Choose the branch (usually `main` or `master`)
- Configure:
  - **Name**: `equinox-server`
  - **Environment**: `Node`
  - **Build Command**: `npm install`
  - **Start Command**: `npm start`
  - **Plan**: Starter (free tier)

### 4. Set Environment Variables
In your web service settings, add these environment variables:

```
NODE_ENV=production
DATABASE_URL=postgresql://watchers_eye_db_user:KTgflWxaluWsHcvcRBacpLuzoPGKCK62@dpg-d3pkt7ili9vc73blnkn0-a/watchers_eye_db
ADMIN_KEY=<generate-a-secure-random-string>
CORS_ORIGINS=https://your-frontend-domain.com
```

### 5. Email Configuration (Optional)
If you want email functionality, add:
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

## Database Schema
The application will automatically create the required tables on first startup:
- `users` - User profiles
- `user_auth` - Authentication data
- `balances` - User balances
- `deposits` - Transaction history
- `stocks` - Stock data
- `user_percentages` - User percentage data

## Security Notes
- The `ADMIN_KEY` should be a long, random string
- Use HTTPS for all production URLs
- Configure CORS_ORIGINS to restrict access to your frontend domains
- Never commit sensitive environment variables to your repository

## Monitoring
- Check the Render dashboard for deployment logs
- Monitor database connections and performance
- Set up alerts for service downtime

## Troubleshooting
- Check build logs if deployment fails
- Verify all environment variables are set correctly
- Ensure database is accessible from the web service
- Check that the start command is correct (`npm start`)
