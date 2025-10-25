import { initDb } from './db.js';

(async () => {
  try {
    await initDb();
    console.log('DB initialized successfully');
    process.exit(0);
  } catch (err) {
    console.error('DB initialization failed:', err);
    process.exit(1);
  }
})();