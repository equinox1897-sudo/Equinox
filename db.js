import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load environment from .env or mail.env (if present) using import.meta.url (works before __dirname is defined)
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mailEnv = path.join(here, 'mail.env');
  const dotEnv = path.join(here, '.env');
  const envCandidate = fs.existsSync(mailEnv) ? mailEnv : dotEnv;
  dotenv.config({ path: envCandidate });
} catch {}

const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL || null;

if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set. Set DATABASE_URL env var or add it to .env (do NOT commit credentials).');
  throw new Error('Missing DATABASE_URL');
}

const pool = new pg.Pool({
  connectionString,
 ssl: {
  require: true,
  rejectUnauthorized: false
}

});

// Basic query wrapper
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res;
}

export function getNow() {
  return new Date().toISOString();
}

// Marker for incremental updates used by server.js (db.increment(n))
export function increment(n) {
  return { __increment: Number(n) };
}

// Initialize DB schema if not present (safe to call at startup)
export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        created_at TIMESTAMP NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_auth (
        uid TEXT PRIMARY KEY REFERENCES users(uid),
        email TEXT,
        password_hash TEXT,
        created_at TIMESTAMP NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS balances (
        uid TEXT PRIMARY KEY REFERENCES users(uid),
        balance_usd NUMERIC DEFAULT 0,
        wallet_balance_usd NUMERIC DEFAULT 0,
        updated_at TIMESTAMP NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        uid TEXT REFERENCES users(uid),
        amount_usd NUMERIC NOT NULL,
        note TEXT,
        created_at TIMESTAMP NOT NULL
      );
    `);

    // optional tables referenced in server.js
    await client.query(`
      CREATE TABLE IF NOT EXISTS stocks (
        id TEXT PRIMARY KEY,
        symbol TEXT,
        name TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_percentages (
        uid TEXT PRIMARY KEY REFERENCES users(uid),
        percentages JSONB,
        updated_at TIMESTAMP NOT NULL
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_auth_email ON user_auth(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_deposits_uid ON deposits(uid);`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findAuthByEmail(email) {
  const res = await query('SELECT * FROM user_auth WHERE email = $1 LIMIT 1', [email]);
  return res.rows[0] || null;
}

export async function createUserRecord({ uid, email, name, created_at }) {
  await query(
    `INSERT INTO users(uid, email, name, created_at)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
    [uid, email, name, created_at]
  );
}

export async function createAuthRecord({ uid, email, password_hash, created_at }) {
  await query(
    `INSERT INTO user_auth(uid, email, password_hash, created_at)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash`,
    [uid, email, password_hash, created_at]
  );
}

export async function upsertBalance({ uid, balance_usd = 0, wallet_balance_usd = 0, updated_at }) {
  await query(
    `INSERT INTO balances(uid, balance_usd, wallet_balance_usd, updated_at)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (uid) DO UPDATE SET
       balance_usd = EXCLUDED.balance_usd,
       wallet_balance_usd = EXCLUDED.wallet_balance_usd,
       updated_at = EXCLUDED.updated_at`,
    [uid, balance_usd, wallet_balance_usd, updated_at]
  );
}

export async function addDeposit({ uid, amount_usd, note, created_at }) {
  const res = await query(
    `INSERT INTO deposits(uid, amount_usd, note, created_at)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [uid, amount_usd, note, created_at]
  );
  return res.rows[0] || null;
}

export async function getBalance(uid) {
  const res = await query('SELECT * FROM balances WHERE uid = $1 LIMIT 1', [uid]);
  return res.rows[0] || null;
}

export async function getUserProfile(uid) {
  const userRes = await query('SELECT * FROM users WHERE uid = $1 LIMIT 1', [uid]);
  const user = userRes.rows[0] || null;
  if (!user) return null;
  const balance = await getBalance(uid);
  return {
    ...user,
    balance_usd: balance ? Number(balance.balance_usd) : 0,
    wallet_balance_usd: balance ? Number(balance.wallet_balance_usd) : 0
  };
}

export async function findUserByEmail(email) {
  const res = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  return res.rows[0] || null;
}

// A light "collection" adapter that mimics the Firestore calls used in server.js
export function collection(name) {
  // map collection names to SQL table names
  const table = (() => {
    switch (name) {
      case 'users': return { table: 'users', pk: 'uid' };
      case 'user_auth': return { table: 'user_auth', pk: 'uid' };
      case 'balances': return { table: 'balances', pk: 'uid' };
      case 'deposits': return { table: 'deposits', pk: 'id' };
      case 'stocks': return { table: 'stocks', pk: 'id' };
      case 'user_percentages': return { table: 'user_percentages', pk: 'uid' };
      default: return { table: name, pk: 'id' };
    }
  })();

  // builder state
  const filters = [];
  let _orderBy = null;
  let _limit = null;

  function buildWhereClause() {
    if (!filters.length) return { clause: '', params: [] };
    const parts = [];
    const params = [];
    filters.forEach((f) => {
      const pidx = params.length + 1;
      if (f.op === '==') {
        parts.push(`${f.field} = $${pidx}`);
        params.push(f.value);
      } else {
        throw new Error('Only "==" where operator is supported by this adapter');
      }
    });
    return { clause: `WHERE ${parts.join(' AND ')}`, params };
  }

  async function get() {
    // SELECT * FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...]
    const where = buildWhereClause();
    const order = _orderBy ? `ORDER BY ${_orderBy.field} ${_orderBy.dir === 'desc' ? 'DESC' : 'ASC'}` : '';
    const lim = _limit ? `LIMIT ${_limit}` : '';
    const sql = `SELECT * FROM ${table.table} ${where.clause} ${order} ${lim}`;
    const res = await query(sql, where.params);
    // emulate Firestore snapshot with docs array
    const docs = res.rows.map(row => ({
      id: row[table.pk],
      data: () => row
    }));
    return { docs, empty: docs.length === 0, rows: res.rows };
  }

  async function add(data) {
    if (table.table === 'deposits') {
      const res = await query(
        `INSERT INTO deposits(uid, amount_usd, note, created_at) VALUES($1,$2,$3,$4) RETURNING id`,
        [data.uid, data.amount_usd, data.note || null, data.created_at]
      );
      const id = res.rows[0].id;
      return doc(id);
    }
    // Generic add - attempt to insert using columns present (works if table has columns)
    const keys = Object.keys(data);
    const vals = keys.map(k => data[k]);
    const params = keys.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${table.table}(${keys.join(',')}) VALUES(${params}) RETURNING ${table.pk}`;
    const res = await query(sql, vals);
    const id = res.rows[0] ? res.rows[0][table.pk] : null;
    return doc(id);
  }

  function doc(id) {
    return {
      async get() {
        const res = await query(`SELECT * FROM ${table.table} WHERE ${table.pk} = $1 LIMIT 1`, [id]);
        const row = res.rows[0];
        return {
          exists: !!row,
          id,
          data: () => row || null
        };
      },
      async set(data) {
        // Try upsert for known tables with uid pk
        if (table.pk === 'uid') {
          const cols = Object.keys(data);
          const vals = cols.map(k => data[k]);
          const setCols = cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
          const sql = `INSERT INTO ${table.table}(${cols.join(',')}) VALUES(${cols.map((_, i) => `$${i+1}`).join(',')})
            ON CONFLICT (${table.pk}) DO UPDATE SET ${setCols}`;
          await query(sql, vals);
          return;
        }
        // For deposits (id), if id provided replace/insert
        if (table.table === 'deposits' && Number.isFinite(Number(id))) {
          // update existing deposit
          const cols = Object.keys(data);
          const sets = cols.map((c, i) => `${c} = $${i+1}`).join(', ');
          const params = cols.map(k => data[k]);
          params.push(id);
          const sql = `UPDATE deposits SET ${sets} WHERE id = $${params.length}`;
          await query(sql, params);
          return;
        }
        // Fallback: attempt upsert using INSERT ... ON CONFLICT (pk) DO UPDATE
        const cols = Object.keys(data);
        const vals = cols.map(k => data[k]);
        const setCols = cols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
        const sql = `INSERT INTO ${table.table}(${cols.join(',')}) VALUES(${cols.map((_, i) => `$${i+1}`).join(',')})
          ON CONFLICT (${table.pk}) DO UPDATE SET ${setCols}`;
        await query(sql, vals);
      },
      async update(patch = {}) {
        // Build update statement supporting increment markers
        const sets = [];
        const params = [];
        let idx = 1;
        for (const [k, v] of Object.entries(patch)) {
          if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__increment')) {
            sets.push(`${k} = ${k} + $${idx}`);
            params.push(v.__increment);
            idx++;
          } else {
            sets.push(`${k} = $${idx}`);
            params.push(v);
            idx++;
          }
        }
        if (!sets.length) return;
        params.push(id);
        const sql = `UPDATE ${table.table} SET ${sets.join(', ')} WHERE ${table.pk} = $${params.length}`;
        await query(sql, params);
      }
    };
  }

  return {
    where(field, op, value) {
      filters.push({ field, op, value });
      return this;
    },
    orderBy(field, dir = 'asc') {
      _orderBy = { field, dir: (dir || 'asc').toLowerCase() };
      return this;
    },
    limit(n) {
      _limit = n;
      return this;
    },
    get,
    add,
    doc
  };
}

export async function closePool() {
  await pool.end();
}