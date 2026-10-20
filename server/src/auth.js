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

export function signToken(userId, secret) {
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
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
  const findUser = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1');
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const data = token && verifyToken(token, secret);
    const user = data && findUser.get(data.sub);
    if (!user) return next(new HttpError(401, 'Not authenticated'));
    req.user = user;
    next();
  };
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, active: !!rest.active };
}
