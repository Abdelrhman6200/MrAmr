// WhatsApp notifications through the WhatsApp Business Cloud API (Meta).
// Off unless WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set. Messages to people
// who haven't written to the business in the last 24 hours must use an approved
// template: set WHATSAPP_TEMPLATE to a template with one body variable ({{1}}),
// which receives the notification text (WHATSAPP_TEMPLATE_LANG, default "ar").
// Without a template, plain text is sent (which WhatsApp only delivers inside
// that 24-hour window).
import { translate } from '../../client/src/i18n.js';
import { linkFor, notificationText } from './mail.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

// Egyptian mobile numbers written locally (01xxxxxxxxx) get the country code;
// everything else is digits only, as WhatsApp wants it.
export function waNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
  if (/^01\d{9}$/.test(digits)) return `2${digits}`;
  return digits.length >= 10 ? digits : '';
}

export function createWhatsApp(env = process.env, fetchImpl = globalThis.fetch) {
  const token = env.WHATSAPP_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { enabled: false, send: async () => {} };
  const template = env.WHATSAPP_TEMPLATE;
  const lang = env.WHATSAPP_TEMPLATE_LANG || 'ar';
  return {
    enabled: true,
    async send(to, text) {
      const body = template
        ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }] } }
        : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000) } };
      const res = await fetchImpl(`${GRAPH}/${phoneId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

// Sends each new notification as a WhatsApp message to people with a phone who
// haven't turned it off. Rows are claimed (whatsapped = 2) so instances don't
// double-send; a failure leaves them for the next run within the day.
export async function dispatchWhatsApp(db, wa, appUrl, { now = Date.now() } = {}) {
  if (!wa.enabled) return 0;
  const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const claimed = await db.all(
    `UPDATE notifications SET whatsapped = 2
     WHERE id IN (SELECT id FROM notifications WHERE whatsapped = 0 AND created_at >= ? ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
    [stamp(now - 864e5)],
  );
  if (!claimed.length) return 0;
  const rows = await db.all(
    `SELECT n.*, u.phone, u.language, u.whatsapp_notifications, u.active
     FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ANY(?::int[]) ORDER BY n.id`,
    [claimed.map((c) => c.id)],
  );
  let sent = 0;
  for (const n of rows) {
    const to = waNumber(n.phone);
    if (!n.active || !n.whatsapp_notifications || !to) {
      await db.run('UPDATE notifications SET whatsapped = 1 WHERE id = ?', [n.id]);
      continue;
    }
    const lang = n.language === 'ar' ? 'ar' : 'en';
    const link = linkFor(appUrl, n);
    const text = `${translate(lang, 'wa.prefix')} ${notificationText(lang, n)}${link ? `\n${link}` : ''}`;
    try {
      await wa.send(to, text);
      await db.run('UPDATE notifications SET whatsapped = 1 WHERE id = ?', [n.id]);
      sent++;
    } catch (err) {
      await db.run('UPDATE notifications SET whatsapped = 0 WHERE id = ?', [n.id]);
      console.error(`WhatsApp to user ${n.user_id} failed, will retry:`, err.message);
    }
  }
  return sent;
}
