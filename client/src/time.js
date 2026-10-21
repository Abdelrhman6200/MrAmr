// The server stores two kinds of time:
//  - events ("created", "last called", "completed"): UTC, as 'YYYY-MM-DD HH:MM:SS'
//  - wall-clock times people choose (call-backs): local, as 'YYYY-MM-DDTHH:MM'
// This turns either (or a full ISO string) into a Date.
const UTC_SQL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;

export function parseServerTime(value) {
  if (!value) return null;
  const s = String(value);
  if (UTC_SQL.test(s)) return new Date(`${s.replace(' ', 'T')}Z`);
  // Date-only strings are calendar days, not instants: read them as local midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00`);
  return new Date(s); // ISO with zone, or local wall-clock 'YYYY-MM-DDTHH:MM'
}
