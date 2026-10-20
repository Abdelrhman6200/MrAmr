export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Normalises an optional YYYY-MM-DD date; '' and null clear the value.
export function optionalDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) throw badRequest(`${field} must be a YYYY-MM-DD date`);
  return value;
}

export function requiredString(value, field, max = 500) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} is too long`);
  return s;
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function optionalId(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} must be an id`);
  return n;
}
