// Small, dependency-free hardening: security headers and login throttling.

export function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
}

// Counts failed logins per (ip, email) and per ip within a sliding window.
export function createLoginLimiter({ windowMs = 15 * 60 * 1000, maxPerAccount = 8, maxPerIp = 40 } = {}) {
  const failures = new Map();
  const recent = (key, now) => {
    const list = (failures.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  const keys = (ip, email) => [`ip:${ip}`, `acct:${ip}:${String(email || '').toLowerCase()}`];

  return {
    // Seconds until the caller may retry, or 0 if allowed.
    retryAfter(ip, email, now = Date.now()) {
      const [ipKey, acctKey] = keys(ip, email);
      const checks = [
        [recent(ipKey, now), maxPerIp],
        [recent(acctKey, now), maxPerAccount],
      ];
      let wait = 0;
      for (const [list, max] of checks) if (list.length >= max) wait = Math.max(wait, Math.ceil((list[0] + windowMs - now) / 1000));
      return wait;
    },
    fail(ip, email, now = Date.now()) {
      for (const key of keys(ip, email)) failures.set(key, [...recent(key, now), now]);
      if (failures.size > 10000) failures.clear(); // memory guard under attack
    },
    succeed(ip, email) {
      failures.delete(keys(ip, email)[1]);
    },
  };
}
