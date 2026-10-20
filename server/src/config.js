import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'taskflow.db');
export const PORT = Number(process.env.PORT) || 3001;
export const STATIC_DIR = path.join(ROOT, 'client', 'dist');

// Use AUTH_SECRET in production; otherwise persist a generated one so logins survive restarts.
export function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = path.join(DATA_DIR, '.secret');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
