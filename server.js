import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { sendWelcomeEmail } from './mailer.js';
import * as db from './db.js';

// Load environment from .env or mail.env (if present) using import.meta.url (works before __dirname is defined)
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mailEnv = path.join(here, 'mail.env');
  const dotEnv = path.join(here, '.env');
  const envCandidate = fs.existsSync(mailEnv) ? mailEnv : dotEnv;
  dotenv.config({ path: envCandidate });
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// If behind a reverse proxy (Render/Heroku/Nginx), trust the first proxy so
// express-rate-limit can correctly read the client IP (X-Forwarded-For)
app.set('trust proxy', 1);

// Security: common HTTP headers and hide tech stack
app.disable('x-powered-by');
app.use(helmet({
  frameguard: { action: 'deny' },
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS: restrict to allowed origins via env; if not configured, allow all to avoid deployment breakage
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // same-origin or curl
    if (allowedOrigins.length === 0) return callback(null, true); // permissive when not configured
    const isAllowed = allowedOrigins.includes(origin);
    callback(isAllowed ? null : new Error('CORS not allowed'), isAllowed);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-admin-key']
}));
app.use(express.json({ limit: '200kb' }));

// Serve static files (HTML, CSS, JS, images)
app.use(express.static(__dirname, {
  index: ['index.html'],
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Route handlers for clean URLs
app.get('/login', (req, res) => {
  res.redirect('/login.html');
});

app.get('/signup', (req, res) => {
  res.redirect('/signup.html');
});

app.get('/home', (req, res) => {
  res.redirect('/home.html');
});

// Basic rate limiting on API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Simple config
const ADMIN_KEY = process.env.ADMIN_KEY || '1738';

// Firestore collections
const USERS_COLLECTION = 'users';
const USER_AUTH_COLLECTION = 'user_auth';
const BALANCES_COLLECTION = 'balances';
const DEPOSITS_COLLECTION = 'deposits';
const STOCKS_COLLECTION = 'stocks';
const USER_PERCENTAGES_COLLECTION = 'user_percentages';

// Helpers
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}


// Routes

// User signup with password
app.post('/api/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    // Check if email already exists (auth or users)
    const existingAuth = await db.findAuthByEmail(email);
    if (existingAuth) {
      return res.status(409).json({ error: 'email_exists' });
    }

    const uid = 'uid_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();

    await db.createUserRecord({ uid, email, name: name || null, created_at: now });
    await db.createAuthRecord({ uid, email, password_hash: passwordHash, created_at: now });

    // default balances
    await db.upsertBalance({ uid, balance_usd: 0, wallet_balance_usd: 0, updated_at: now });
    await db.addDeposit({ uid, amount_usd: 0, note: 'default', created_at: now });

    const profile = await db.getUserProfile(uid);

    // async welcome email
    sendWelcomeEmail(email).catch(err => console.error('Welcome email failed:', err.message));

    res.json({ ok: true, profile });
  } catch (e) {
    console.error('Signup error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// User login with password
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'invalid_input' });

    const auth = await db.findAuthByEmail(email);
    if (!auth) return res.status(404).json({ error: 'not_found' });

    const passwordHash = hashPassword(password);
    if (auth.password_hash !== passwordHash) return res.status(401).json({ error: 'invalid_credentials' });

    const profile = await db.getUserProfile(auth.uid);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get all users (admin only)
app.get('/api/users', async (req, res) => {
  try {
    const key = req.header('x-admin-key');
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    
    const usersSnapshot = await db.collection(USERS_COLLECTION)
      .orderBy('created_at', 'desc')
      .get();
    
    const users = [];
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const balanceDoc = await db.collection(BALANCES_COLLECTION).doc(userData.uid).get();
      const balanceData = balanceDoc.exists ? balanceDoc.data() : { balance_usd: 0, wallet_balance_usd: 0 };
      
      users.push({
        ...userData,
        balance_usd: balanceData.balance_usd || 0,
        wallet_balance_usd: balanceData.wallet_balance_usd || 0
      });
    }
    
    res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Upsert user registration (legacy endpoint for compatibility)
app.post('/api/register', async (req, res) => {
  try {
    const { uid, email, name } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid is required' });
    
    const now = db.getNow();
    const DEFAULT_HOME_BALANCE = 0;
    
    // Upsert user
    await db.collection(USERS_COLLECTION).doc(uid).set({
      uid,
      email: email || null,
      name: name || null,
      created_at: now
    }, { merge: true });
    
    // Check if balance exists
    const balanceDoc = await db.collection(BALANCES_COLLECTION).doc(uid).get();
    
    if (!balanceDoc.exists) {
      await db.collection(BALANCES_COLLECTION).doc(uid).set({
        uid,
        balance_usd: 0,
        wallet_balance_usd: DEFAULT_HOME_BALANCE,
        updated_at: now
      });
    } else {
      const balanceData = balanceDoc.data();
      if ((balanceData.wallet_balance_usd || 0) === 0) {
        await db.collection(BALANCES_COLLECTION).doc(uid).update({
          wallet_balance_usd: DEFAULT_HOME_BALANCE,
          updated_at: now
        });
      }
    }
    
    // Ensure a matching deposit record exists for Personal feed
    const existingDefaultDeposit = await db.collection(DEPOSITS_COLLECTION)
      .where('uid', '==', uid)
      .where('note', '==', 'default')
      .limit(1)
      .get();
    
    if (existingDefaultDeposit.empty) {
      await db.collection(DEPOSITS_COLLECTION).add({
        uid,
        amount_usd: DEFAULT_HOME_BALANCE,
        note: 'default',
        created_at: now
      });
    }
    
    // Get profile
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    const updatedBalanceDoc = await db.collection(BALANCES_COLLECTION).doc(uid).get();
    const balanceData = updatedBalanceDoc.exists ? updatedBalanceDoc.data() : { balance_usd: 0, wallet_balance_usd: 0 };
    
    const profile = {
      ...userDoc.data(),
      balance_usd: balanceData.balance_usd || 0,
      wallet_balance_usd: balanceData.wallet_balance_usd || 0
    };
    
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get profile by uid
app.get('/api/profile/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'not_found' });
    }
    
    const balanceDoc = await db.collection(BALANCES_COLLECTION).doc(uid).get();
    const balanceData = balanceDoc.exists ? balanceDoc.data() : { balance_usd: 0, wallet_balance_usd: 0 };
    
    const profile = {
      ...userDoc.data(),
      balance_usd: balanceData.balance_usd || 0,
      wallet_balance_usd: balanceData.wallet_balance_usd || 0
    };
    
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Manual deposit (admin-only)
app.post('/api/deposits/manual', async (req, res) => {
  try {
    const key = req.header('x-admin-key');
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    
    const { uid, amountUsd } = req.body || {};
    const amount = Number(amountUsd);
    if (!uid || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    
    const now = db.getNow();
    
    // Always tag gas-balance deposits as gas_fee for correct personal feed labeling
    await db.collection(DEPOSITS_COLLECTION).add({
      uid,
      amount_usd: amount,
      note: 'gas_fee',
      created_at: now
    });
    
    // Update or create balance
    const balanceRef = db.collection(BALANCES_COLLECTION).doc(uid);
    const balanceDoc = await balanceRef.get();
    
    if (balanceDoc.exists) {
      await balanceRef.update({
        balance_usd: db.increment(amount),
        updated_at: now
      });
    } else {
      await balanceRef.set({
        uid,
        balance_usd: amount,
        wallet_balance_usd: 0,
        updated_at: now
      });
    }
    
    // Get updated profile
    const updatedBalanceDoc = await balanceRef.get();
    const balanceData = updatedBalanceDoc.data();
    
    const profile = {
      ...userDoc.data(),
      balance_usd: balanceData.balance_usd || 0,
      wallet_balance_usd: balanceData.wallet_balance_usd || 0
    };
    
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Manual deposit to wallet (home) balance (admin-only)
app.post('/api/deposits/manual/home', async (req, res) => {
  try {
    const key = req.header('x-admin-key');
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    
    const { uid, amountUsd, note } = req.body || {};
    const amount = Number(amountUsd);
    if (!uid || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    
    const now = db.getNow();
    
    await db.collection(DEPOSITS_COLLECTION).add({
      uid,
      amount_usd: amount,
      note: note || 'wallet',
      created_at: now
    });
    
    // Update or create balance
    const balanceRef = db.collection(BALANCES_COLLECTION).doc(uid);
    const balanceDoc = await balanceRef.get();
    
    if (balanceDoc.exists) {
      await balanceRef.update({
        wallet_balance_usd: db.increment(amount),
        updated_at: now
      });
    } else {
      await balanceRef.set({
        uid,
        balance_usd: 0,
        wallet_balance_usd: amount,
        updated_at: now
      });
    }
    
    // Get updated profile
    const updatedBalanceDoc = await balanceRef.get();
    const balanceData = updatedBalanceDoc.data();
    
    const profile = {
      ...userDoc.data(),
      balance_usd: balanceData.balance_usd || 0,
      wallet_balance_usd: balanceData.wallet_balance_usd || 0
    };
    
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// User deposit attempt (record deposit request)
app.post('/api/deposits/attempt', async (req, res) => {
  try {
    const { uid, amountUsd, asset, address, depositType } = req.body || {};
    const amount = Number(amountUsd);
    
    if (!uid || !Number.isFinite(amount) || amount <= 0 || !asset || !address) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    
    // Check if user exists
    const userResult = await db.query('SELECT uid FROM users WHERE uid = $1', [uid]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    
    const now = db.getNow();
    
    // Record deposit attempt with appropriate note based on deposit type
    let note;
    if (depositType === 'gas_fee') {
      note = `gas_fee_attempt_${asset}_${address}`;
    } else {
      note = `deposit_attempt_${asset}_${address}`;
    }
    
    await db.query(`
      INSERT INTO deposits (uid, amount_usd, note, created_at) 
      VALUES ($1, $2, $3, $4)
    `, [uid, amount, note, now]);
    
    res.json({ 
      ok: true, 
      message: 'Deposit attempt recorded. Payment will be processed within 1-3 hours.',
      deposit_id: Date.now() // Simple ID for reference
    });
  } catch (e) {
    console.error('Deposit attempt error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// List all deposits for a user (admin-only, includes deposit attempts)
app.get('/api/deposits/admin/:uid', async (req, res) => {
  try {
    const key = req.header('x-admin-key');
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid_required' });
    
    // Get all deposits including attempts
    const depositsResult = await db.query(`
      SELECT id, uid, amount_usd, note, created_at 
      FROM deposits 
      WHERE uid = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [uid]);
    
    const deposits = depositsResult.rows.map(row => ({
      id: row.id,
      uid: row.uid,
      amount_usd: row.amount_usd,
      note: row.note,
      created_at: row.created_at
    }));
    
    res.json({ ok: true, deposits });
  } catch (e) {
    console.error('Admin deposits fetch error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// List recent deposits for a user (admin and user-visible feed)
app.get('/api/deposits/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid_required' });
    
    // Get deposits from database, filtering out deposit attempts
    const depositsResult = await db.query(`
      SELECT id, uid, amount_usd, note, created_at 
      FROM deposits 
      WHERE uid = $1 
      AND note NOT LIKE 'deposit_attempt_%'
      AND note NOT LIKE 'gas_fee_attempt_%'
      ORDER BY created_at DESC 
      LIMIT 20
    `, [uid]);
    
    const deposits = depositsResult.rows.map(row => ({
      id: row.id,
      uid: row.uid,
      amount_usd: row.amount_usd,
      note: row.note,
      created_at: row.created_at
    }));
    
    res.json({ ok: true, deposits });
  } catch (e) {
    console.error('Deposits fetch error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get all stocks
app.get('/api/stocks', async (req, res) => {
  try {
    const stocksResult = await db.query(`
      SELECT company, current_price, percentage_change, direction, updated_at 
      FROM stocks 
      ORDER BY company ASC
    `);
    
    const stocks = stocksResult.rows.map(row => ({
      company: row.company,
      current_price: row.current_price,
      percentage_change: row.percentage_change,
      direction: row.direction,
      updated_at: row.updated_at
    }));
    
    res.json({ ok: true, stocks });
  } catch (e) {
    console.error('Stocks fetch error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Update stock percentage (admin-only)
app.post('/api/stocks/update-percentage', async (req, res) => {
  try {
    const key = req.header('x-admin-key');
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    
    const { company, currentPrice, percentage, direction } = req.body || {};
    const price = Number(currentPrice);
    const pct = Number(percentage);
    
    if (!company || !Number.isFinite(price) || price <= 0 || !Number.isFinite(pct) || pct < 0 || !direction) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    
    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: 'invalid_direction' });
    }
    
    const now = db.getNow();
    const multiplier = direction === 'up' ? (1 + pct / 100) : (1 - pct / 100);
    const newPrice = price * multiplier;
    
    // Store stock data in database
    await db.query(`
      INSERT INTO stocks (company, current_price, percentage_change, direction, updated_at) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (company) 
      DO UPDATE SET current_price = $2, percentage_change = $3, direction = $4, updated_at = $5
    `, [company, newPrice, pct, direction, now]);
    
    res.json({ 
      ok: true, 
      message: 'Stock percentage updated successfully',
      newPrice: newPrice.toFixed(2)
    });
  } catch (e) {
    console.error('Stock update error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get current percentage data
app.get('/api/percentage/current', async (req, res) => {
  try {
    const { uid } = req.query;
    const hasUid = typeof uid === 'string' && uid.trim().length > 0;
    
    console.log('Fetching percentage data for uid:', uid);
    
    if (hasUid) {
      // Get user-specific percentage
      const result = await db.query(`
        SELECT percentages FROM user_percentages WHERE uid = $1
      `, [uid]);
      
      if (result.rows.length > 0) {
        const percentageData = result.rows[0].percentages;
        console.log('Found user percentage:', percentageData);
        return res.json({ ok: true, percentage: percentageData });
      }
    }
    
    // Get global percentage
    const globalResult = await db.query(`
      SELECT percentages FROM user_percentages WHERE uid = '__global__'
    `);
    
    if (globalResult.rows.length > 0) {
      const percentageData = globalResult.rows[0].percentages;
      console.log('Found global percentage:', percentageData);
      return res.json({ ok: true, percentage: percentageData });
    }
    
    // No percentage data found
    console.log('No percentage data found, returning default');
    res.json({ ok: true, percentage: { value: 0, direction: 'neutral' } });
  } catch (e) {
    console.error('Percentage fetch error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Update percentage bubble (admin-only)
app.post('/api/percentage/update', async (req, res) => {
  try {
    const key = req.header('x-admin-key');
    if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    
    const { uid, value, direction } = req.body || {};
    const hasUid = typeof uid === 'string' && uid.trim().length > 0;
    const percentageValue = Number(value);
    
    if (!Number.isFinite(percentageValue) || percentageValue < 0) {
      return res.status(400).json({ error: 'invalid_percentage_value' });
    }
    
    if (!['up', 'down', 'neutral'].includes(direction)) {
      return res.status(400).json({ error: 'invalid_direction' });
    }
    
    const now = db.getNow();
    
    if (hasUid) {
      // Check if user exists
      const userResult = await db.query('SELECT uid FROM users WHERE uid = $1', [uid]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'user_not_found' });
      }
      
      // Update or insert percentage data
      const percentageData = {
        value: percentageValue,
        direction: direction
      };
      
      await db.query(`
        INSERT INTO user_percentages (uid, percentages, updated_at) 
        VALUES ($1, $2, $3)
        ON CONFLICT (uid) 
        DO UPDATE SET percentages = $2, updated_at = $3
      `, [uid, JSON.stringify(percentageData), now]);
      
      return res.json({ ok: true, scope: 'user', percentage: percentageData });
    } else {
      // Global percentage update
      const GLOBAL_UID = '__global__';
      const percentageData = {
        value: percentageValue,
        direction: direction
      };
      
      await db.query(`
        INSERT INTO user_percentages (uid, percentages, updated_at) 
        VALUES ($1, $2, $3)
        ON CONFLICT (uid) 
        DO UPDATE SET percentages = $2, updated_at = $3
      `, [GLOBAL_UID, JSON.stringify(percentageData), now]);
      
      return res.json({ ok: true, scope: 'global', percentage: percentageData });
    }
  } catch (e) {
    console.error('Percentage update error:', e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Withdraw: deduct from home wallet balance and gas fee balance, record entries
app.post('/api/withdraw', async (req, res) => {
  try {
    const { uid, amountUsd, gasUsd, displayedUsd } = req.body || {};
    const amount = Number(amountUsd);
    const gas = Number(gasUsd);
    
    if (!uid || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(gas) || gas < 0) {
      return res.status(400).json({ error: 'invalid_params' });
    }
    
    const balanceRef = db.collection(BALANCES_COLLECTION).doc(uid);
    const balanceDoc = await balanceRef.get();
    
    if (!balanceDoc.exists) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    
    const balanceData = balanceDoc.data();
    const gas_bal = balanceData.balance_usd || 0;
    const home_bal = balanceData.wallet_balance_usd || 0;
    
    // If the client displays an adjusted balance (percentage bubble), treat that as effective available
    const effectiveHome = Number.isFinite(Number(displayedUsd)) && Number(displayedUsd) > home_bal ? Number(displayedUsd) : home_bal;
    
    if (effectiveHome < amount) {
      return res.status(400).json({ error: 'insufficient_home_balance' });
    }
    if (gas_bal < gas) {
      return res.status(400).json({ error: 'insufficient_gas_balance' });
    }
    
    const now = db.getNow();
    
    // If we are using an effectiveHome above db, first bump db to effective then deduct, to keep consistency
    if (effectiveHome > home_bal) {
      const bump = effectiveHome - home_bal;
      await balanceRef.update({
        wallet_balance_usd: db.increment(bump),
        updated_at: now
      });
    }
    
    // Deduct amounts
    await balanceRef.update({
      wallet_balance_usd: db.increment(-amount),
      balance_usd: gas > 0 ? db.increment(-gas) : balanceData.balance_usd,
      updated_at: now
    });
    
    // Record negative amount as withdraw and gas fee entry
    await db.collection(DEPOSITS_COLLECTION).add({
      uid,
      amount_usd: -amount,
      note: 'withdraw',
      created_at: now
    });
    
    if (gas > 0) {
      await db.collection(DEPOSITS_COLLECTION).add({
        uid,
        amount_usd: -gas,
        note: 'gas_fee',
        created_at: now
      });
    }

    // Get updated profile
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    const updatedBalanceDoc = await balanceRef.get();
    const updatedBalance = updatedBalanceDoc.data();

    const profile = {
      ...userDoc.data(),
      balance_usd: updatedBalance.balance_usd || 0,
      wallet_balance_usd: updatedBalance.wallet_balance_usd || 0
    };

    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// --- ensure server starts ---
(async () => {
  try {
    // quick connectivity test
    try {
      await db.query('SELECT 1');
      console.log('DB connection test: OK');
    } catch (connErr) {
      console.error('DB connection test: FAILED', connErr.message || connErr);
      // continue to init attempt — will throw if fatal
    }

    // initialize schema (safe if already created)
    await db.initDb();
    console.log('DB schema initialization: OK');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
})();


