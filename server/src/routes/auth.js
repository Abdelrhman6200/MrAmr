import { Router } from 'express';
import { hashPassword, publicUser, requireAuth, signToken, verifyPassword } from '../auth.js';
import { HttpError, badRequest } from '../http.js';
import { createLoginLimiter } from '../security.js';
import { renderEmail } from '../mail.js';
import { background } from '../background.js';
import { translate } from '../../../client/src/i18n.js';
import { createResetToken, findResetToken, setPassword } from '../passwords.js';
import { bump } from '../db.js';

const RESET_HOURS = 1;
// Checked when an email has no account, so a wrong email takes as long as a wrong password.
const DECOY_HASH = hashPassword('decoy-password-never-used');

export default function authRoutes({ db, secret, mailer, appUrl }) {
  const r = Router();
  const byEmail = (email) => db.get('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  const byId = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]);
  const limiter = createLoginLimiter(db);
  // Stops "forgot password" from being used to flood someone's inbox.
  const resetLimiter = createLoginLimiter(db, { namespace: 'reset', maxPerAccount: 3, maxPerIp: 10 });
  const canEmailResets = () => mailer.enabled && !!appUrl;

  r.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    const wait = await limiter.retryAfter(req.ip, email);
    if (wait) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.', 'rate_limited', { minutes: Math.ceil(wait / 60) });
    }
    const user = email ? await byEmail(email) : null;
    const passwordOk = verifyPassword(String(password || ''), user ? user.password_hash : DECOY_HASH);
    if (!user || !user.active || !passwordOk) {
      await limiter.fail(req.ip, email);
      throw new HttpError(401, 'Invalid email or password');
    }
    await limiter.succeed(req.ip, email);
    res.json({ token: signToken(user, secret), user: publicUser(user) });
  });

  // First run: while nobody has an account, the first visitor creates the Head of Company.
  r.post('/setup', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().toLowerCase();
    if (!name) throw badRequest('name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw badRequest('email is invalid');
    if (typeof b.password !== 'string' || b.password.length < 8) throw badRequest('password must be at least 8 characters');
    const user = await db.tx(async (tx) => {
      await tx.run('SELECT pg_advisory_xact_lock(4244)');
      if ((await tx.get('SELECT COUNT(*) AS n FROM users')).n > 0) return null;
      const created = await tx.get(
        "INSERT INTO users (name, email, password_hash, role, avatar_color, language) VALUES (?, ?, ?, 'ceo', '#15803d', ?) RETURNING *",
        [name, email, hashPassword(b.password), b.language === 'ar' ? 'ar' : 'en'],
      );
      await bump(tx, 'org');
      return created;
    });
    if (!user) throw new HttpError(409, 'TaskFlow is already set up. Sign in instead.', 'already_setup');
    res.status(201).json({ token: signToken(user, secret), user: publicUser(user) });
  });

  r.get('/me', requireAuth(db, secret), (req, res) => res.json({ user: publicUser(req.user) }));

  // Signs out other devices; this one gets a fresh token.
  r.post('/change-password', requireAuth(db, secret), async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyPassword(String(currentPassword || ''), req.user.password_hash)) throw badRequest('Current password is incorrect');
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw badRequest('New password must be at least 8 characters');
    await setPassword(db, req.user.id, newPassword);
    res.json({ ok: true, token: signToken(await byId(req.user.id), secret) });
  });

  // Always answers the same way so it can't be used to discover who has an account.
  r.post('/forgot', async (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!canEmailResets()) return res.json({ ok: true, email_enabled: false });
    if (!email || (await resetLimiter.retryAfter(req.ip, email))) return res.json({ ok: true, email_enabled: true });
    await resetLimiter.fail(req.ip, email);
    const user = await byEmail(email);
    if (user && user.active) {
      const token = await createResetToken(db, user.id, RESET_HOURS);
      const lang = user.language === 'ar' ? 'ar' : 'en';
      const t = (k, v) => translate(lang, k, v);
      const { html, text } = renderEmail(lang, {
        heading: t('mail.resetHeading'),
        paragraphs: [t('mail.resetIntro', { name: user.name.split(' ')[0] }), t('mail.resetExpiry', { hours: RESET_HOURS }), t('mail.resetIgnore')],
        button: { url: `${appUrl}/reset?token=${token}`, label: t('mail.resetButton') },
      });
      // Not awaited: replying only after the send would reveal which emails have accounts.
      background('Password reset email', () => mailer.send({ to: user.email, subject: t('mail.resetSubject'), html, text }));
    }
    res.json({ ok: true, email_enabled: true });
  });

  r.get('/reset/:token', async (req, res) => {
    const reset = await findResetToken(db, req.params.token);
    if (!reset) throw new HttpError(400, 'This reset link is invalid or has expired', 'reset_invalid');
    res.json({ name: reset.name, email: reset.email });
  });

  r.post('/reset', async (req, res) => {
    const { token, password } = req.body || {};
    const reset = await findResetToken(db, token);
    if (!reset) throw new HttpError(400, 'This reset link is invalid or has expired', 'reset_invalid');
    if (typeof password !== 'string' || password.length < 8) throw badRequest('New password must be at least 8 characters');
    await setPassword(db, reset.user_id, password);
    const user = await byId(reset.user_id);
    res.json({ token: signToken(user, secret), user: publicUser(user) });
  });

  return r;
}
