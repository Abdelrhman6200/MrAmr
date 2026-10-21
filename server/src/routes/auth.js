import { Router } from 'express';
import { hashPassword, publicUser, requireAuth, signToken, verifyPassword } from '../auth.js';
import { HttpError, badRequest } from '../http.js';
import { createLoginLimiter } from '../security.js';

export default function authRoutes({ db, secret }) {
  const r = Router();
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const limiter = createLoginLimiter();

  r.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const wait = limiter.retryAfter(req.ip, email);
    if (wait) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.', 'rate_limited', { minutes: Math.ceil(wait / 60) });
    }
    const user = email && byEmail.get(String(email).trim());
    if (!user || !user.active || !verifyPassword(String(password || ''), user.password_hash)) {
      limiter.fail(req.ip, email);
      throw new HttpError(401, 'Invalid email or password');
    }
    limiter.succeed(req.ip, email);
    res.json({ token: signToken(user.id, secret), user: publicUser(user) });
  });

  r.get('/me', requireAuth(db, secret), (req, res) => res.json({ user: publicUser(req.user) }));

  r.post('/change-password', requireAuth(db, secret), (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyPassword(String(currentPassword || ''), req.user.password_hash)) throw badRequest('Current password is incorrect');
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw badRequest('New password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    res.json({ ok: true });
  });

  return r;
}
