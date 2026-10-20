import { Router } from 'express';

export default function notificationRoutes({ db }) {
  const r = Router();

  r.get('/', (req, res) => {
    const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n;
    res.json({ unread, items: items.map((n) => ({ ...n, read: !!n.read, params: parse(n.params) })) });
  });

  r.post('/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  r.post('/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
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
