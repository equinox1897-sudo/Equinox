import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { sendWelcomeEmail } from './mailer.js';

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
const SQLITE_ADMIN_USER = process.env.SQLITE_ADMIN_USER || 'admin';
const SQLITE_ADMIN_PASS = process.env.SQLITE_ADMIN_PASS || '';

// Init DB
const dbFile = process.env.DB_FILE || path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_auth (
    uid TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER,
    FOREIGN KEY(uid) REFERENCES users(uid)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS balances (
    uid TEXT PRIMARY KEY,
    balance_usd REAL NOT NULL DEFAULT 0,
    wallet_balance_usd REAL NOT NULL DEFAULT 0,
    updated_at INTEGER,
    FOREIGN KEY(uid) REFERENCES users(uid)
  )`);

  // Best-effort migration in case the column was missing in existing DBs
  db.run(`ALTER TABLE balances ADD COLUMN wallet_balance_usd REAL NOT NULL DEFAULT 0`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    note TEXT,
    created_at INTEGER,
    FOREIGN KEY(uid) REFERENCES users(uid)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT UNIQUE NOT NULL,
    current_price REAL NOT NULL,
    percentage_change REAL NOT NULL,
    direction TEXT NOT NULL,
    updated_at INTEGER
  )`);
  
  // Percentage bubble per user
  db.run(`CREATE TABLE IF NOT EXISTS user_percentages (
    uid TEXT PRIMARY KEY,
    value REAL NOT NULL,
    direction TEXT NOT NULL,
    updated_at INTEGER,
    FOREIGN KEY(uid) REFERENCES users(uid)
  )`);
});

// Helpers
function getNow() { return Date.now(); }

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err){
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function(err, row){
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function(err, rows){
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}


// Routes

// User signup with password
app.post('/api/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'email_and_password_required_min_6_chars' });
    }
    
    // Check if email already exists
    const existingUser = await get(`SELECT uid FROM user_auth WHERE email=?`, [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'email_already_registered' });
    }
    
    // Generate unique UID
    const uid = 'uid_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
    const passwordHash = hashPassword(password);
    const now = getNow();
    
    // Create user profile
    await run(`INSERT INTO users(uid, email, name, created_at) VALUES(?,?,?,?)`,
      [uid, email, name || null, now]);
    
    // Create authentication record
    await run(`INSERT INTO user_auth(uid, email, password_hash, created_at) VALUES(?,?,?,?)`,
      [uid, email, passwordHash, now]);
    
    // Allocate default Home balance (set to 0)
    const DEFAULT_HOME_BALANCE = 0;
    await run(`INSERT INTO balances(uid, balance_usd, wallet_balance_usd, updated_at) VALUES(?,?,?,?)`,
      [uid, 0, DEFAULT_HOME_BALANCE, now]);
    
    // Create default deposit record (0 amount)
    await run(`INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES(?,?,?,?)`,
      [uid, DEFAULT_HOME_BALANCE, 'default', now]);
    
    // Return user profile
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [uid]);
    
    // Send welcome email (async, don't wait for it)
    sendWelcomeEmail(email).catch(err => 
      console.error('Welcome email failed:', err.message)
    );
    
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// User login with password
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email_and_password_required' });
    }
    
    // Find user by email
    const auth = await get(`SELECT ua.uid, ua.password_hash, u.email, u.name
                           FROM user_auth ua 
                           JOIN users u ON u.uid = ua.uid 
                           WHERE ua.email=?`, [email]);
    
    if (!auth) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    // Verify password
    const passwordHash = hashPassword(password);
    if (auth.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    // Return user profile
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [auth.uid]);
    
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
    
    const users = await all(`SELECT u.uid, u.email, u.name, u.created_at,
                                   IFNULL(b.balance_usd, 0) as balance_usd,
                                   IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                            FROM users u LEFT JOIN balances b ON b.uid=u.uid
                            ORDER BY u.created_at DESC`);
    
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
    await run(`INSERT INTO users(uid, email, name, created_at) VALUES(?,?,?,?)
              ON CONFLICT(uid) DO UPDATE SET email=excluded.email, name=excluded.name`,
      [uid, email || null, name || null, getNow()]);
    // Allocate default Home balance on first registration (set to 0)
    const DEFAULT_HOME_BALANCE = 0;
    await run(`INSERT INTO balances(uid, balance_usd, wallet_balance_usd, updated_at) VALUES(?,?,?,?)
              ON CONFLICT(uid) DO NOTHING`, [uid, 0, DEFAULT_HOME_BALANCE, getNow()]);
    // If the user already existed and has zero home balance, allocate it now
    await run(`UPDATE balances SET wallet_balance_usd=? , updated_at=?
               WHERE uid=? AND IFNULL(wallet_balance_usd,0)=0`, [DEFAULT_HOME_BALANCE, getNow(), uid]);

    // Ensure a matching deposit record exists for Personal feed
    const existsDefault = await get(`SELECT 1 AS ok FROM deposits WHERE uid=? AND note='default' LIMIT 1`, [uid]);
    if (!existsDefault?.ok) {
      await run(`INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES(?,?,?,?)`, [uid, DEFAULT_HOME_BALANCE, 'default', getNow()]);
    }
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [uid]);
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get profile by uid
app.get('/api/profile/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [uid]);
    if (!profile) return res.status(404).json({ error: 'not_found' });
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
    if (!uid || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_params' });
    const user = await get(`SELECT uid FROM users WHERE uid=?`, [uid]);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    // Always tag gas-balance deposits as gas_fee for correct personal feed labeling
    await run(`INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES(?,?,?,?)`, [uid, amount, 'gas_fee', getNow()]);
    await run(`INSERT INTO balances(uid, balance_usd, updated_at) VALUES(?,?,?)
               ON CONFLICT(uid) DO UPDATE SET balance_usd = balance_usd + excluded.balance_usd, updated_at=excluded.updated_at`,
      [uid, amount, getNow()]);
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [uid]);
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
    if (!uid || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_params' });
    const user = await get(`SELECT uid FROM users WHERE uid=?`, [uid]);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    await run(`INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES(?,?,?,?)`, [uid, amount, (note || 'wallet'), getNow()]);
    await run(`INSERT INTO balances(uid, wallet_balance_usd, updated_at) VALUES(?,?,?)
               ON CONFLICT(uid) DO UPDATE SET wallet_balance_usd = wallet_balance_usd + excluded.wallet_balance_usd, updated_at=excluded.updated_at`,
      [uid, amount, getNow()]);
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [uid]);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// List recent deposits for a user (admin and user-visible feed)
app.get('/api/deposits/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid_required' });
    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT id, uid, amount_usd, note, created_at FROM deposits WHERE uid=? ORDER BY id DESC LIMIT 20`, [uid], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    res.json({ ok: true, deposits: rows });
  } catch (e) {
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
    const row = await get(`SELECT IFNULL(balance_usd,0) as gas_bal, IFNULL(wallet_balance_usd,0) as home_bal FROM balances WHERE uid=?`, [uid]);
    if (!row) return res.status(404).json({ error: 'user_not_found' });
    // If the client displays an adjusted balance (percentage bubble), treat that as effective available
    const effectiveHome = Number.isFinite(Number(displayedUsd)) && Number(displayedUsd) > row.home_bal ? Number(displayedUsd) : row.home_bal;
    if (effectiveHome < amount) return res.status(400).json({ error: 'insufficient_home_balance' });
    if (row.gas_bal < gas) return res.status(400).json({ error: 'insufficient_gas_balance' });
    const now = getNow();
    // If we are using an effectiveHome above db, first bump db to effective then deduct, to keep consistency
    if (effectiveHome > row.home_bal) {
      const bump = effectiveHome - row.home_bal;
      await run(`UPDATE balances SET wallet_balance_usd = wallet_balance_usd + ?, updated_at=? WHERE uid=?`, [bump, now, uid]);
    }
    await run(`UPDATE balances SET wallet_balance_usd = wallet_balance_usd - ?, updated_at=? WHERE uid=?`, [amount, now, uid]);
    if (gas > 0) {
      await run(`UPDATE balances SET balance_usd = balance_usd - ?, updated_at=? WHERE uid=?`, [gas, now, uid]);
    }
    // Record negative amount as withdraw and gas fee entry
    await run(`INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES(?,?,?,?)`, [uid, -amount, 'withdraw', now]);
    if (gas > 0) await run(`INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES(?,?,?,?)`, [uid, -gas, 'gas_fee', now]);
    const profile = await get(`SELECT u.uid, u.email, u.name,
                                      IFNULL(b.balance_usd, 0) as balance_usd,
                                      IFNULL(b.wallet_balance_usd, 0) as wallet_balance_usd
                               FROM users u LEFT JOIN balances b ON b.uid=u.uid WHERE u.uid=?`, [uid]);
    res.json({ ok: true, profile });
  } catch (e) {
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
    
    const now = getNow();
    
    // Calculate the new price based on percentage change
    const multiplier = direction === 'up' ? (1 + pct / 100) : (1 - pct / 100);
    const newPrice = price * multiplier;
    
    // Insert or update stock data with the calculated new price
    await run(`INSERT INTO stocks(company, current_price, percentage_change, direction, updated_at) 
               VALUES(?,?,?,?,?) 
               ON CONFLICT(company) DO UPDATE SET 
                 current_price=excluded.current_price,
                 percentage_change=excluded.percentage_change,
                 direction=excluded.direction,
                 updated_at=excluded.updated_at`,
      [company, newPrice, pct, direction, now]);
    
    res.json({ 
      ok: true, 
      message: 'Stock percentage updated successfully',
      newPrice: newPrice.toFixed(2)
    });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get all stocks data
app.get('/api/stocks', async (req, res) => {
  try {
    const stocks = await all(`SELECT company, current_price, percentage_change, direction, updated_at 
                             FROM stocks ORDER BY company`);
    res.json({ ok: true, stocks });
  } catch (e) {
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
    
    const now = getNow();
    
    if (hasUid) {
      const user = await get(`SELECT uid FROM users WHERE uid=?`, [uid]);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      await run(`INSERT INTO user_percentages(uid, value, direction, updated_at)
                 VALUES(?,?,?,?)
                 ON CONFLICT(uid) DO UPDATE SET value=excluded.value, direction=excluded.direction, updated_at=excluded.updated_at`,
        [uid, percentageValue, direction, now]);
      const row = await get(`SELECT uid, value, direction, updated_at FROM user_percentages WHERE uid=?`, [uid]);
      return res.json({ ok: true, scope: 'user', percentage: row });
    } else {
      // Persist a global percentage row using a reserved uid key
      const GLOBAL_UID = '__global__';
      await run(`INSERT INTO user_percentages(uid, value, direction, updated_at)
                 VALUES(?,?,?,?)
                 ON CONFLICT(uid) DO UPDATE SET value=excluded.value, direction=excluded.direction, updated_at=excluded.updated_at`,
        [GLOBAL_UID, percentageValue, direction, now]);
      const row = await get(`SELECT uid, value, direction, updated_at FROM user_percentages WHERE uid=?`, [GLOBAL_UID]);
      return res.json({ ok: true, scope: 'global', percentage: row });
    }
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Get current percentage bubble value
app.get('/api/percentage/current', async (req, res) => {
  try {
    const uid = (req.query?.uid || '').trim?.() || '';
    if (uid) {
      const row = await get(`SELECT uid, value, direction, updated_at FROM user_percentages WHERE uid=?`, [uid]);
      if (row) return res.json({ ok: true, scope: 'user', percentage: row });
    }
    const GLOBAL_UID = '__global__';
    const globalRow = await get(`SELECT uid, value, direction, updated_at FROM user_percentages WHERE uid=?`, [GLOBAL_UID]);
    const percentageData = globalRow || { value: 0, direction: 'neutral', updated_at: Date.now() };
    res.json({ ok: true, scope: 'global', percentage: percentageData });
  } catch (e) {
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// Clean URLs: map "/page" -> "page.html" if present
app.get('/:page', (req, res, next) => {
  const p = (req.params?.page || '').trim();
  if (!p || p.includes('/') || p.includes('..')) return next();
  if (p === 'api') return next();
  const candidate = path.join(__dirname, `${p}.html`);
  if (fs.existsSync(candidate)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(candidate);
  }
  next();
});

app.use('/', express.static(__dirname, {
  dotfiles: 'ignore',
  index: ['preview.html', 'index.html', 'home.html', 'home_updated.html'],
  setHeaders(res, filePath) {
    // Prevent caching of HTML; allow static caching for others via far-future handled by host/CDN
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

// --- Protected SQLite browser (basic) ---
function requireSqliteAuth(req, res, next){
  try {
    const hdr = String(req.headers['authorization'] || '');
    if (!hdr.startsWith('Basic ')) return res.status(401).set('WWW-Authenticate','Basic realm="sqlite"').end('Auth required');
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const pass = idx >= 0 ? decoded.slice(idx+1) : '';
    if (user === SQLITE_ADMIN_USER && pass === SQLITE_ADMIN_PASS && SQLITE_ADMIN_PASS) return next();
    return res.status(401).set('WWW-Authenticate','Basic realm="sqlite"').end('Unauthorized');
  } catch {
    return res.status(401).set('WWW-Authenticate','Basic realm="sqlite"').end('Unauthorized');
  }
}

// List tables
app.get('/api/sqlite/tables', requireSqliteAuth, async (req, res) => {
  try {
    const rows = await all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
    res.json({ ok: true, tables: rows.map(r => r.name) });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Run SQL (CAUTION). For convenience, allow SELECT to return rows; others return info
app.post('/api/sqlite/query', requireSqliteAuth, async (req, res) => {
  try {
    const sql = String((req.body && req.body.sql) || '').trim();
    if (!sql) return res.status(400).json({ ok:false, error:'empty_sql' });
    // Very light guard: disallow dropping the DB file itself; allow DML/DDL at your risk
    const isSelect = /^\s*select\b/i.test(sql);
    if (isSelect) {
      const rows = await all(sql);
      res.json({ ok:true, rows });
    } else {
      const info = await run(sql);
      res.json({ ok:true, changes: info?.changes ?? 0, lastID: info?.lastID });
    }
  } catch (e) {
    res.status(400).json({ ok:false, error: String(e?.message || e) });
  }
});

// Simple HTML UI for quick DB access
app.get('/sqlite', requireSqliteAuth, (req, res) => {
  res.setHeader('Cache-Control','no-store');
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>SQLite Admin</title><style>body{font-family:Inter,Segoe UI,Arial;margin:0;background:#0b0f15;color:#e6e9ef} .wrap{max-width:1100px;margin:0 auto;padding:16px} textarea{width:100%;min-height:140px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:#e6e9ef;padding:12px;box-sizing:border-box} button{padding:10px 14px;border-radius:8px;border:0;background:#2f67ff;color:#fff;font-weight:700;cursor:pointer} pre{white-space:pre-wrap;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:8px} .card{border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;background:linear-gradient(180deg,#0e1420,#0b101b);margin-top:12px} .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center} select{padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#111827;color:#e6e9ef} </style></head><body><div class="wrap"><h2>SQLite Admin</h2><div class="card"><div class="row"><button id="refresh">Refresh Tables</button><select id="tables"></select><button id="selectAll">SELECT * FROM table</button></div></div><div class="card"><textarea id="sql" placeholder="Write SQL here... e.g., SELECT * FROM users LIMIT 20;"></textarea><div class="row" style="margin-top:10px;"><button id="run">Run</button></div></div><div class="card"><div id="out">Output will appear here</div></div></div><script>async function j(u,o){const r=await fetch(u,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));return r.json()} async function loadTables(){try{const r=await j('/api/sqlite/tables');const s=document.getElementById('tables');s.innerHTML='';(r.tables||[]).forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;s.appendChild(o)})}catch(e){console.error(e)}} document.getElementById('refresh').addEventListener('click',loadTables); document.getElementById('selectAll').addEventListener('click',()=>{const t=document.getElementById('tables').value||'';if(!t)return;document.getElementById('sql').value=\`SELECT * FROM \${t} LIMIT 50;\`}); document.getElementById('run').addEventListener('click',async()=>{const sql=document.getElementById('sql').value||'';const out=document.getElementById('out');out.textContent='Running...';try{const r=await j('/api/sqlite/query',{method:'POST',body:JSON.stringify({sql})});if(!r.ok){out.textContent='Error: '+(r.error||'');return} if(Array.isArray(r.rows)){const rows=r.rows; if(rows.length===0){out.textContent='No rows.';return} const cols=Object.keys(rows[0]); const table=document.createElement('table'); table.style.width='100%'; table.style.borderCollapse='collapse'; const thead=document.createElement('thead'); const tr=document.createElement('tr'); cols.forEach(c=>{const th=document.createElement('th'); th.textContent=c; th.style.textAlign='left'; th.style.borderBottom='1px solid rgba(255,255,255,.12)'; th.style.padding='6px 8px'; thead.appendChild(tr); tr.appendChild(th) }); table.appendChild(thead); const tbody=document.createElement('tbody'); rows.forEach(rw=>{const trb=document.createElement('tr'); cols.forEach(c=>{const td=document.createElement('td'); td.textContent=rw[c]; td.style.padding='6px 8px'; td.style.borderBottom='1px solid rgba(255,255,255,.06)'; trb.appendChild(td)}); tbody.appendChild(trb)}); table.appendChild(tbody); out.innerHTML=''; out.appendChild(table); } else { out.textContent = 'OK. Changes: ' + (r.changes||0) + (r.lastID? (', lastID: '+r.lastID):''); } }catch(e){out.textContent='Error: '+e}}); loadTables();</script></body></html>`);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Watchers Eye API running on http://localhost:${PORT}`);
});


