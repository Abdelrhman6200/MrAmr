import crypto from 'node:crypto';
import { hashPassword } from './auth.js';
import { nowUtc } from './time.js';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const inHours = (hours) => new Date(Date.now() + hours * 36e5).toISOString().replace('T', ' ').slice(0, 19);

// Returns a single-use token; only its hash is stored. `q` is the db or a transaction.
export async function createResetToken(q, userId, hours, createdBy = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q.run('INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?)', [
    userId,
    hash(token),
    inHours(hours),
    createdBy,
  ]);
  return token;
}

export async function findResetToken(q, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  return q.get(
    `SELECT r.*, u.email, u.name, u.language FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.active = 1`,
    [hash(token), nowUtc()],
  );
}

// Sets the password, burns every outstanding reset token and signs out all sessions.
export async function setPassword(q, userId, password) {
  await q.tx(async (tx) => {
    await tx.run('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?', [hashPassword(password), userId]);
    await tx.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [nowUtc(), userId]);
  });
}
