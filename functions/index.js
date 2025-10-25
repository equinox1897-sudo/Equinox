import { onRequest } from 'firebase-functions/v2/https';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Helper functions
function getNow() {
  return Date.now();
}

function increment(value) {
  return admin.firestore.FieldValue.increment(value);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Firestore collections
const USERS_COLLECTION = 'users';
const USER_AUTH_COLLECTION = 'user_auth';
const BALANCES_COLLECTION = 'balances';
const DEPOSITS_COLLECTION = 'deposits';
const STOCKS_COLLECTION = 'stocks';
const USER_PERCENTAGES_COLLECTION = 'user_percentages';

const ADMIN_KEY = process.env.ADMIN_KEY || '1738';

const app = express();

// Middleware
app.use(helmet({
  frameguard: { action: 'deny' },
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: true }));
app.use(express.json({ limit: '200kb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(apiLimiter);

// User signup with password
app.post('/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'email_and_password_required_min_6_chars' });
    }
    
    const existingUserSnapshot = await db.collection(USER_AUTH_COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();
    
    if (!existingUserSnapshot.empty) {
      return res.status(400).json({ error: 'email_already_registered' });
    }
    
    const uid = 'uid_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
    const passwordHash = hashPassword(password);
    const now = getNow();
    
    await db.collection(USERS_COLLECTION).doc(uid).set({
      uid,
      email,
      name: name || null,
      created_at: now
    });
    
    await db.collection(USER_AUTH_COLLECTION).doc(uid).set({
      uid,
      email,
      password_hash: passwordHash,
      created_at: now
    });
    
    const DEFAULT_HOME_BALANCE = 0;
    await db.collection(BALANCES_COLLECTION).doc(uid).set({
      uid,
      balance_usd: 0,
      wallet_balance_usd: DEFAULT_HOME_BALANCE,
      updated_at: now
    });
    
    await db.collection(DEPOSITS_COLLECTION).add({
      uid,
      amount_usd: DEFAULT_HOME_BALANCE,
      note: 'default',
      created_at: now
    });
    
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    const balanceDoc = await db.collection(BALANCES_COLLECTION).doc(uid).get();
    const balanceData = balanceDoc.exists ? balanceDoc.data() : { balance_usd: 0, wallet_balance_usd: 0 };
    
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

// User login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email_and_password_required' });
    }
    
    const authSnapshot = await db.collection(USER_AUTH_COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();
    
    if (authSnapshot.empty) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    const authDoc = authSnapshot.docs[0];
    const authData = authDoc.data();
    
    const passwordHash = hashPassword(password);
    if (authData.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    const userDoc = await db.collection(USERS_COLLECTION).doc(authData.uid).get();
    const balanceDoc = await db.collection(BALANCES_COLLECTION).doc(authData.uid).get();
    const balanceData = balanceDoc.exists ? balanceDoc.data() : { balance_usd: 0, wallet_balance_usd: 0 };
    
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

// Get all users (admin only)
app.get('/users', async (req, res) => {
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

// Get profile
app.get('/profile/:uid', async (req, res) => {
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

// Manual deposit
app.post('/deposits/manual', async (req, res) => {
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
    
    const now = getNow();
    
    await db.collection(DEPOSITS_COLLECTION).add({
      uid,
      amount_usd: amount,
      note: 'gas_fee',
      created_at: now
    });
    
    const balanceRef = db.collection(BALANCES_COLLECTION).doc(uid);
    const balanceDoc = await balanceRef.get();
    
    if (balanceDoc.exists) {
      await balanceRef.update({
        balance_usd: increment(amount),
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

// List deposits
app.get('/deposits/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid_required' });
    
    const depositsSnapshot = await db.collection(DEPOSITS_COLLECTION)
      .where('uid', '==', uid)
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();
    
    const deposits = depositsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({ ok: true, deposits });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Withdraw
app.post('/withdraw', async (req, res) => {
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
    
    const effectiveHome = Number.isFinite(Number(displayedUsd)) && Number(displayedUsd) > home_bal ? Number(displayedUsd) : home_bal;
    
    if (effectiveHome < amount) {
      return res.status(400).json({ error: 'insufficient_home_balance' });
    }
    if (gas_bal < gas) {
      return res.status(400).json({ error: 'insufficient_gas_balance' });
    }
    
    const now = getNow();
    
    if (effectiveHome > home_bal) {
      const bump = effectiveHome - home_bal;
      await balanceRef.update({
        wallet_balance_usd: increment(bump),
        updated_at: now
      });
    }
    
    await balanceRef.update({
      wallet_balance_usd: increment(-amount),
      balance_usd: gas > 0 ? increment(-gas) : balanceData.balance_usd,
      updated_at: now
    });
    
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
    
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    const updatedBalanceDoc = await balanceRef.get();
    const updatedBalanceData = updatedBalanceDoc.data();
    
    const profile = {
      ...userDoc.data(),
      balance_usd: updatedBalanceData.balance_usd || 0,
      wallet_balance_usd: updatedBalanceData.wallet_balance_usd || 0
    };
    
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get stocks
app.get('/stocks', async (req, res) => {
  try {
    const stocksSnapshot = await db.collection(STOCKS_COLLECTION)
      .orderBy('company')
      .get();
    
    const stocks = stocksSnapshot.docs.map(doc => doc.data());
    
    res.json({ ok: true, stocks });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Update stock percentage
app.post('/stocks/update-percentage', async (req, res) => {
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
    
    const now = getNow();
    const multiplier = direction === 'up' ? (1 + pct / 100) : (1 - pct / 100);
    const newPrice = price * multiplier;
    
    await db.collection(STOCKS_COLLECTION).doc(company).set({
      company,
      current_price: newPrice,
      percentage_change: pct,
      direction,
      updated_at: now
    });
    
    res.json({ 
      ok: true, 
      message: 'Stock percentage updated successfully',
      newPrice: newPrice.toFixed(2)
    });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get percentage
app.get('/percentage/current', async (req, res) => {
  try {
    const uid = (req.query?.uid || '').trim?.() || '';
    
    if (uid) {
      const percentageDoc = await db.collection(USER_PERCENTAGES_COLLECTION).doc(uid).get();
      if (percentageDoc.exists) {
        return res.json({ ok: true, scope: 'user', percentage: percentageDoc.data() });
      }
    }
    
    const GLOBAL_UID = '__global__';
    const globalDoc = await db.collection(USER_PERCENTAGES_COLLECTION).doc(GLOBAL_UID).get();
    const percentageData = globalDoc.exists ? globalDoc.data() : { value: 0, direction: 'neutral', updated_at: Date.now() };
    
    res.json({ ok: true, scope: 'global', percentage: percentageData });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Update percentage
app.post('/percentage/update', async (req, res) => {
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
    
    const now = getNow();
    
    if (hasUid) {
      const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'user_not_found' });
      }
      
      await db.collection(USER_PERCENTAGES_COLLECTION).doc(uid).set({
        uid,
        value: percentageValue,
        direction,
        updated_at: now
      });
      
      const percentageDoc = await db.collection(USER_PERCENTAGES_COLLECTION).doc(uid).get();
      return res.json({ ok: true, scope: 'user', percentage: percentageDoc.data() });
    } else {
      const GLOBAL_UID = '__global__';
      await db.collection(USER_PERCENTAGES_COLLECTION).doc(GLOBAL_UID).set({
        uid: GLOBAL_UID,
        value: percentageValue,
        direction,
        updated_at: now
      });
      
      const percentageDoc = await db.collection(USER_PERCENTAGES_COLLECTION).doc(GLOBAL_UID).get();
      return res.json({ ok: true, scope: 'global', percentage: percentageDoc.data() });
    }
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Export the Express app as a Firebase Function
export const api = onRequest(app);
