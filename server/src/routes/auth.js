import { Router } from 'express';
import { hashPassword, publicUser, requireAuth, signToken, verifyPassword } from '../auth.js';
import { HttpError, badRequest } from '../http.js';
import { createLoginLimiter } from '../security.js';
import { renderEmail } from '../mail.js';
import { translate } from '../../../client/src/i18n.js';
import { createResetToken, findResetToken, setPassword } from '../passwords.js';

const RESET_HOURS = 1;
// Checked when an email has no account, so a wrong email takes as long as a wrong password.
const DECOY_HASH = hashPassword('decoy-password-never-used');

export default function authRoutes({ db, secret, mailer, appUrl }) {
  const r = Router();
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const limiter = createLoginLimiter();
  // Stops "forgot password" from being used to flood someone's inbox.
  const resetLimiter = createLoginLimiter({ maxPerAccount: 3, maxPerIp: 10 });
  const canEmailResets = () => mailer.enabled && !!appUrl;

  r.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const wait = limiter.retryAfter(req.ip, email);
    if (wait) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.', 'rate_limited', { minutes: Math.ceil(wait / 60) });
    }
    const user = email && byEmail.get(String(email).trim());
    const passwordOk = verifyPassword(String(password || ''), user ? user.password_hash : DECOY_HASH);
    if (!user || !user.active || !passwordOk) {
      limiter.fail(req.ip, email);
      throw new HttpError(401, 'Invalid email or password');
    }
    limiter.succeed(req.ip, email);
    res.json({ token: signToken(user, secret), user: publicUser(user) });
  });

  r.get('/me', requireAuth(db, secret), (req, res) => res.json({ user: publicUser(req.user) }));

  // Signs out other devices; this one gets a fresh token.
  r.post('/change-password', requireAuth(db, secret), (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyPassword(String(currentPassword || ''), req.user.password_hash)) throw badRequest('Current password is incorrect');
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw badRequest('New password must be at least 8 characters');
    setPassword(db, req.user.id, newPassword);
    res.json({ ok: true, token: signToken(byId.get(req.user.id), secret) });
  });

  // Always answers the same way so it can't be used to discover who has an account.
  r.post('/forgot', (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!canEmailResets()) return res.json({ ok: true, email_enabled: false });
    if (!email || resetLimiter.retryAfter(req.ip, email)) return res.json({ ok: true, email_enabled: true });
    resetLimiter.fail(req.ip, email);
    const user = byEmail.get(email);
    if (user && user.active) {
      const token = createResetToken(db, user.id, RESET_HOURS);
      const lang = user.language === 'ar' ? 'ar' : 'en';
      const t = (k, v) => translate(lang, k, v);
      const { html, text } = renderEmail(lang, {
        heading: t('mail.resetHeading'),
        paragraphs: [t('mail.resetIntro', { name: user.name.split(' ')[0] }), t('mail.resetExpiry', { hours: RESET_HOURS }), t('mail.resetIgnore')],
        button: { url: `${appUrl}/reset?token=${token}`, label: t('mail.resetButton') },
      });
      // Not awaited: replying only after the send would reveal which emails have accounts.
      mailer.send({ to: user.email, subject: t('mail.resetSubject'), html, text }).catch((err) => console.error('Password reset email failed:', err.message));
    }
    res.json({ ok: true, email_enabled: true });
  });

  r.get('/reset/:token', (req, res) => {
    const reset = findResetToken(db, req.params.token);
    if (!reset) throw new HttpError(400, 'This reset link is invalid or has expired', 'reset_invalid');
    res.json({ name: reset.name, email: reset.email });
  });

  r.post('/reset', (req, res) => {
    const { token, password } = req.body || {};
    const reset = findResetToken(db, token);
    if (!reset) throw new HttpError(400, 'This reset link is invalid or has expired', 'reset_invalid');
    if (typeof password !== 'string' || password.length < 8) throw badRequest('New password must be at least 8 characters');
    setPassword(db, reset.user_id, password);
    const user = byId.get(reset.user_id);
    res.json({ token: signToken(user, secret), user: publicUser(user) });
  });

  return r;
}
