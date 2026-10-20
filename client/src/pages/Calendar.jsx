import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { todayISO, useTaskDialog } from '../components/ui.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// 2024-01-01 was a Monday.
const weekdayName = (i, locale) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' });

export default function CalendarPage() {
  const { version, t, locale } = useApp();
  const { open, create } = useTaskDialog();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [scope, setScope] = useState('mine');
  const [tasks, setTasks] = useState([]);

  // Grid starts on the Monday on/before the 1st and spans 6 weeks.
  const start = new Date(cursor);
  start.setDate(1 - ((cursor.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const from = iso(days[0]);
  const to = iso(days[41]);

  useEffect(() => {
    api.get('/tasks', { from, to, scope: scope === 'all' ? '' : scope }).then(setTasks);
  }, [from, to, scope, version]);

  const byDay = {};
  for (const task of tasks) (byDay[task.due_date] ||= []).push(task);
  const today = todayISO();
  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <div className="page">
      <div className="page-head">
        <h1>{cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h1>
        <div className="row gap">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="mine">{t('cal.mine')}</option>
            <option value="team">{t('cal.team')}</option>
            <option value="all">{t('cal.all')}</option>
          </select>
          <div className="seg">
            <button onClick={() => shift(-1)} aria-label={t('cal.prev')}>
              <span className="flip">‹</span>
            </button>
            <button
              onClick={() => {
                const d = new Date();
                setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
            >
              {t('cal.today')}
            </button>
            <button onClick={() => shift(1)} aria-label={t('cal.next')}>
              <span className="flip">›</span>
            </button>
          </div>
        </div>
      </div>
      <div className="calendar">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className="cal-head">
            {weekdayName(i, locale)}
          </div>
        ))}
        {days.map((d) => {
          const key = iso(d);
          const list = byDay[key] || [];
          return (
            <div
              key={key}
              className={`cal-day ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`}
              onDoubleClick={() => create({ due_date: key })}
            >
              <div className="cal-num">{d.getDate()}</div>
              {list.slice(0, 4).map((task) => (
                <button
                  key={task.id}
                  className={`cal-task status-${task.status} ${task.status !== 'done' && key < today ? 'late' : ''}`}
                  style={{ borderInlineStartColor: task.project_color || '#94a3b8' }}
                  onClick={() => open(task.id)}
                  title={`${task.title} — ${task.assignee_name || t('common.unassigned')}`}
                >
                  {task.title}
                </button>
              ))}
              {list.length > 4 && <div className="muted sm">{t('cal.more', { n: list.length - 4 })}</div>}
            </div>
          );
        })}
      </div>
      <p className="muted sm">{t('cal.tip')}</p>
    </div>
  );
}
