import { createApp } from './app.js';
import { openDb } from './db.js';
import { DB_FILE, PORT, STATIC_DIR, loadSecret } from './config.js';
import { seed } from './seed.js';

const db = openDb(DB_FILE);
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  seed(db);
  console.log('Empty database — loaded demo organisation (password: password123)');
}

const app = createApp({ db, secret: loadSecret(), staticDir: STATIC_DIR });
app.listen(PORT, () => console.log(`TaskFlow API listening on http://localhost:${PORT}`));
