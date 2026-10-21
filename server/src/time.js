// One format for every timestamp the server records: UTC 'YYYY-MM-DD HH:MM:SS',
// identical to SQLite's datetime('now'), so SQL comparisons are plain string compares.
export const nowUtc = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Call-back times are local wall-clock 'YYYY-MM-DDTHH:MM' (what the person picked);
// compare them against local "now" in the same shape.
export const SQL_LOCAL_NOW_MINUTE = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

// Start of today in local time, expressed in UTC for comparing with stored timestamps.
export const SQL_LOCAL_TODAY_START = "datetime('now', 'localtime', 'start of day', 'utc')";
