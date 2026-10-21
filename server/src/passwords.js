import crypto from 'node:crypto';
import { hashPassword } from './auth.js';
import { transaction } from './db.js';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Returns a single-use token; only its hash is stored.
export function createResetToken(db, userId, hours, createdBy = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES (?, ?, datetime('now', ?), ?)").run(
    userId,
    hash(token),
    `+${hours} hours`,
    createdBy,
  );
  return token;
}

export function findResetToken(db, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  return db
    .prepare(
      `SELECT r.*, u.email, u.name, u.language FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > datetime('now') AND u.active = 1`,
    )
    .get(hash(token));
}

// Sets the password, burns every outstanding reset token and signs out all sessions.
export function setPassword(db, userId, password) {
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(hashPassword(password), userId);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(userId);
  });
}
