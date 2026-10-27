import crypto from 'node:crypto';
import { HttpError } from './http.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(user, secret) {
  const payload = b64(JSON.stringify({ sub: user.id, v: user.session_version ?? 0, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token, secret) {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function requireAuth(db, secret) {
  return async (req, _res, next) => {
    try {
      const header = req.get('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const data = token && verifyToken(token, secret);
      // The org-chart version comes along so permission checks need no extra round trip.
      const row =
        data &&
        Number.isInteger(data.sub) &&
        (await db.get("SELECT u.*, (SELECT value FROM app_state WHERE key = 'org') AS org_version FROM users u WHERE u.id = ? AND u.active = 1", [
          data.sub,
        ]));
      if (!row || (data.v ?? 0) !== (row.session_version ?? 0)) return next(new HttpError(401, 'Not authenticated'));
      const { org_version, ...user } = row;
      req.user = user;
      req.orgVersion = Number(org_version ?? 0);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, session_version, ...rest } = u;
  return { ...rest, active: !!rest.active, email_notifications: rest.email_notifications !== 0, whatsapp_notifications: rest.whatsapp_notifications !== 0 };
}
