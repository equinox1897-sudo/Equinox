CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS user_auth (
  uid TEXT PRIMARY KEY REFERENCES users(uid),
  email TEXT,
  password_hash TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  uid TEXT PRIMARY KEY REFERENCES users(uid),
  balance_usd NUMERIC DEFAULT 0,
  wallet_balance_usd NUMERIC DEFAULT 0,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  uid TEXT REFERENCES users(uid),
  amount_usd NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_auth_email ON user_auth(email);