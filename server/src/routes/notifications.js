import { Router } from 'express';
import { idParam } from '../http.js';

export default function notificationRoutes({ db }) {
  const r = Router();

  r.get('/', async (req, res) => {
    const [items, count] = await Promise.all([
      db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [req.user.id]),
      db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', [req.user.id]),
    ]);
    res.json({ unread: count.n, items: items.map((n) => ({ ...n, read: !!n.read, params: parse(n.params) })) });
  });

  r.post('/read-all', async (req, res) => {
    await db.run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', [req.user.id]);
    res.json({ ok: true });
  });

  r.post('/:id/read', async (req, res) => {
    await db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [idParam(req.params.id), req.user.id]);
    res.json({ ok: true });
  });

  return r;
}

function parse(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
