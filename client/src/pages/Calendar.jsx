import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { todayISO, useTaskDialog } from '../components/ui.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarPage() {
  const { version } = useApp();
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
  for (const t of tasks) (byDay[t.due_date] ||= []).push(t);
  const today = todayISO();
  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <div className="page">
      <div className="page-head">
        <h1>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1>
        <div className="row gap">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="mine">My tasks</option>
            <option value="team">My team</option>
            <option value="all">Everything I can see</option>
          </select>
          <div className="seg">
            <button onClick={() => shift(-1)} aria-label="Previous month">
              ‹
            </button>
            <button
              onClick={() => {
                const d = new Date();
                setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
            >
              Today
            </button>
            <button onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
          </div>
        </div>
      </div>
      <div className="calendar">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-head">
            {d}
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
              {list.slice(0, 4).map((t) => (
                <button
                  key={t.id}
                  className={`cal-task status-${t.status} ${t.status !== 'done' && key < today ? 'late' : ''}`}
                  style={{ borderLeftColor: t.project_color || '#94a3b8' }}
                  onClick={() => open(t.id)}
                  title={`${t.title} — ${t.assignee_name || 'Unassigned'}`}
                >
                  {t.title}
                </button>
              ))}
              {list.length > 4 && <div className="muted sm">+{list.length - 4} more</div>}
            </div>
          );
        })}
      </div>
      <p className="muted sm">Tip: double-click a day to create a task due that day.</p>
    </div>
  );
}
