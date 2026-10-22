// Outgoing email: password resets and notification emails.
// Email is optional — without SMTP_HOST the app works and simply doesn't send mail.
import nodemailer from 'nodemailer';
import { translate } from '../../client/src/i18n.js';

export function createMailer(env = process.env) {
  if (!env.SMTP_HOST) return { enabled: false, send: async () => false };
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' || env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return {
    enabled: true,
    send: async ({ to, subject, text, html }) => {
      await transport.sendMail({ from, to, subject, text, html });
      return true;
    },
  };
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A simple, mail-client-safe layout in the app's green, right-to-left for Arabic.
export function renderEmail(lang, { heading, paragraphs = [], items = [], button }) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f3f8f4;font-family:Tahoma,Arial,sans-serif;color:#13261a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #d9e8de" dir="${dir}">
<tr><td style="background:#15803d;color:#fff;padding:14px 20px;font-weight:bold;font-size:18px;border-radius:12px 12px 0 0;text-align:${align}">✓ TaskFlow</td></tr>
<tr><td style="padding:20px;text-align:${align};font-size:15px;line-height:1.6">
<h2 style="margin:0 0 12px;font-size:18px">${escape(heading)}</h2>
${paragraphs.map((p) => `<p style="margin:0 0 12px">${escape(p)}</p>`).join('')}
${items.length ? `<ul style="padding-${align}:18px;margin:0 0 16px">${items.map((i) => `<li style="margin-bottom:6px">${i.url ? `<a href="${escape(i.url)}" style="color:#15803d">${escape(i.text)}</a>` : escape(i.text)}</li>`).join('')}</ul>` : ''}
${button ? `<p><a href="${escape(button.url)}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">${escape(button.label)}</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs, ...items.map((i) => `- ${i.text}${i.url ? ` (${i.url})` : ''}`), button ? `\n${button.label}: ${button.url}` : ''].join('\n');
  return { html, text };
}

// Turns stored notification parts into a message in the reader's language.
export function notificationText(lang, n) {
  let params = null;
  try {
    params = n.params ? JSON.parse(n.params) : null;
  } catch {
    params = null;
  }
  if (!params) return n.message;
  const key = `notif.${n.type}`;
  const text = translate(lang, key, { ...params, day: params.day && translate(lang, `day.${params.day}`) });
  return text === key ? n.message : text;
}

const linkFor = (appUrl, n) => (!appUrl ? null : n.link ? `${appUrl}${n.link}` : n.task_id ? `${appUrl}/?task=${n.task_id}` : appUrl);

// Per-user retry back-off after a failed send: 1, 2, 4 … minutes, capped at 30.
const backoff = new Map();
const STALE_CLAIM_MS = 10 * 60_000;

// Sends each user one email summarising their new notifications.
// Rows are claimed atomically (emailed = 2) so several server instances never
// send the same notification twice; they're marked done (1) once the email has
// gone out, or released (0) to be retried on failure (within a day).
export async function dispatchNotificationEmails(db, mailer, appUrl, { now = Date.now() } = {}) {
  if (!mailer.enabled) return 0;
  const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const claimed = await db.all(
    `UPDATE notifications SET emailed = 2, email_claimed_at = ?
     WHERE id IN (
       SELECT id FROM notifications
       WHERE created_at >= ? AND (emailed = 0 OR (emailed = 2 AND email_claimed_at < ?))
         AND NOT (user_id = ANY(?::int[]))
       ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
    [stamp(now), stamp(now - 864e5), stamp(now - STALE_CLAIM_MS), [...backoff].filter(([, b]) => b.retryAt > now).map(([id]) => id)],
  );
  if (!claimed.length) return 0;
  const rows = await db.all(
    `SELECT n.*, u.email, u.name AS user_name, u.language, u.email_notifications, u.active
     FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ANY(?::int[]) ORDER BY n.id`,
    [claimed.map((c) => c.id)],
  );
  const settle = (ids, emailed) => db.run('UPDATE notifications SET emailed = ?, email_claimed_at = NULL WHERE id = ANY(?::int[])', [emailed, ids]);
  const byUser = new Map();
  const skipped = [];
  for (const n of rows) {
    // Nothing to send for people who opted out or left: settle these straight away.
    if (!n.active || !n.email_notifications) {
      skipped.push(n.id);
      continue;
    }
    if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
    byUser.get(n.user_id).push(n);
  }
  if (skipped.length) await settle(skipped, 1);
  let sent = 0;
  for (const list of byUser.values()) {
    const u = list[0];
    const ids = list.map((n) => n.id);
    const lang = u.language === 'ar' ? 'ar' : 'en';
    const t = (k, v) => translate(lang, k, v);
    const { html, text } = renderEmail(lang, {
      heading: t('mail.notifHeading', { name: u.user_name.split(' ')[0] }),
      items: list.map((n) => ({ text: notificationText(lang, n), url: linkFor(appUrl, n) })),
      paragraphs: [],
      button: appUrl ? { url: appUrl, label: t('mail.open') } : null,
    });
    try {
      await mailer.send({ to: u.email, subject: t('mail.notifSubject', { n: list.length }), html, text: `${text}\n\n${t('mail.optOut')}` });
      await settle(ids, 1);
      backoff.delete(u.user_id);
      sent++;
    } catch (err) {
      await settle(ids, 0);
      const failures = (backoff.get(u.user_id)?.failures ?? 0) + 1;
      backoff.set(u.user_id, { failures, retryAt: now + Math.min(60_000 * 2 ** (failures - 1), 30 * 60_000) });
      console.error(`Notification email to ${u.email} failed (attempt ${failures}), will retry:`, err.message);
    }
  }
  return sent;
}

// Runs dispatch at most once at a time per instance; a request that arrives while
// one is running schedules exactly one more run afterwards.
export function emailDispatcher(db, mailer, appUrl) {
  let running = null;
  let again = false;
  const run = async () => {
    try {
      do {
        again = false;
        await dispatchNotificationEmails(db, mailer, appUrl);
      } while (again);
    } catch (err) {
      console.error('Notification email dispatch failed:', err.message);
    } finally {
      running = null;
    }
  };
  return () => {
    if (!mailer.enabled) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = run();
    return running;
  };
}

// For a long-running server: also sweep every minute (retries, stale claims).
export function startNotificationEmails(dispatch, mailer, intervalMs = 60_000) {
  if (!mailer.enabled) return () => {};
  const timer = setInterval(dispatch, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
