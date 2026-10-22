import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const PORT = Number(process.env.PORT) || 3001;
export const STATIC_DIR = path.join(ROOT, 'client', 'dist');

// Where the built-in database (PGlite) keeps its files when DATABASE_URL isn't set.
export const localDataDir = () => {
  const dir = path.join(DATA_DIR, 'pg');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Use AUTH_SECRET in production; otherwise persist a generated one so logins survive restarts.
export function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.VERCEL) throw new Error('Set AUTH_SECRET in the Vercel project settings (any long random string).');
  const file = path.join(DATA_DIR, '.secret');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

// Comma-separated web app addresses allowed to call the API from another origin.
export const corsOrigins = () => (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
