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

// Counts failed attempts per (ip, email) and per ip within a sliding window. Stored in
// the database so the limit holds across every server instance. `namespace` keeps
// separate limits apart (e.g. sign-in vs. password-reset requests).
export function createLoginLimiter(db, { namespace = 'login', windowMs = 15 * 60 * 1000, maxPerAccount = 8, maxPerIp = 40 } = {}) {
  const keys = (ip, email) => [`${namespace}:ip:${ip}`, `${namespace}:acct:${ip}:${String(email || '').trim().toLowerCase()}`];

  return {
    // Seconds until the caller may retry, or 0 if allowed.
    async retryAfter(ip, email, now = Date.now()) {
      const [ipKey, acctKey] = keys(ip, email);
      const rows = await db.all(
        'SELECT key, COUNT(*)::int AS n, MIN(at) AS first FROM login_failures WHERE key = ANY(?::text[]) AND at > ? GROUP BY key',
        [[ipKey, acctKey], now - windowMs],
      );
      let wait = 0;
      for (const r of rows) {
        const max = r.key === ipKey ? maxPerIp : maxPerAccount;
        if (r.n >= max) wait = Math.max(wait, Math.ceil((Number(r.first) + windowMs - now) / 1000));
      }
      return wait;
    },
    async fail(ip, email, now = Date.now()) {
      const [ipKey, acctKey] = keys(ip, email);
      await db.run('INSERT INTO login_failures (key, at) VALUES (?, ?), (?, ?)', [ipKey, now, acctKey, now]);
      // Housekeeping: forget attempts that can no longer count.
      if (Math.random() < 0.05) await db.run('DELETE FROM login_failures WHERE at < ?', [now - windowMs]);
    },
    async succeed(ip, email) {
      await db.run('DELETE FROM login_failures WHERE key = ?', [keys(ip, email)[1]]);
    },
  };
}

// Lets a separately hosted web app (e.g. on Vercel) call this API.
// `origins` is a list like ['https://tasks.example.com', 'https://taskflow-*.vercel.app'];
// '*' matches a single DNS label, so 'https://*.vercel.app' cannot match 'evil.com/.vercel.app'.
export function cors(origins) {
  const patterns = origins.map((o) => {
    const escaped = o.trim().replace(/\/+$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
    return new RegExp(`^${escaped}$`, 'i');
  });
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || !patterns.some((re) => re.test(origin))) {
      if (req.method === 'OPTIONS' && origin) return res.status(403).end();
      return next();
    }
    res.set({
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Disposition, Retry-After',
      'Access-Control-Max-Age': '600',
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}
