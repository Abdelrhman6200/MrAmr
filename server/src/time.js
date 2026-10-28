// All timestamps the server records are UTC text 'YYYY-MM-DD HH:MM:SS', so SQL can
// compare them as plain strings. Local-time values (today's date, call-back times)
// use APP_TIMEZONE — hosts like Vercel always run in UTC, so we can't rely on TZ.
export const APP_TIMEZONE = pickTimeZone(process.env);

// APP_TIMEZONE if valid, else TZ unless it is just the host's UTC (Vercel sets
// TZ=":UTC", which isn't a name Intl accepts), else Cairo.
export function pickTimeZone(env) {
  const valid = (z) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: z });
      return true;
    } catch {
      return false;
    }
  };
  const app = String(env.APP_TIMEZONE || '').trim();
  if (app && valid(app)) return app;
  if (app) console.warn(`APP_TIMEZONE "${app}" is not a time zone; using Africa/Cairo.`);
  const tz = String(env.TZ || '').trim().replace(/^:/, '');
  if (tz && !/^(UTC|Etc\/UTC|GMT|Etc\/GMT|Z|UCT)$/i.test(tz) && valid(tz)) return tz;
  return 'Africa/Cairo';
}

const utc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export const nowUtc = () => utc(Date.now());
export const utcAgo = (ms) => utc(Date.now() - ms);
export const DAY = 864e5;

// Wall-clock parts of `ms` in the app's time zone.
function localParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

// 'YYYY-MM-DD' of today (+ offset days) in the app's time zone.
export function localDate(offsetDays = 0) {
  const p = localParts(Date.now() + offsetDays * DAY);
  return `${p.year}-${p.month}-${p.day}`;
}

// Local 'YYYY-MM-DDTHH:MM', the shape call-back times are stored in.
export function localNowMinute() {
  const p = localParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// The UTC timestamp of local midnight today, for "since the start of today" queries.
export function localTodayStartUtc() {
  const now = Date.now();
  const p = localParts(now);
  const sinceMidnight = (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + (now % 1000);
  return utc(now - sinceMidnight);
}
