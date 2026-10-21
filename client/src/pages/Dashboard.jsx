import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { ActivityText } from '../components/TaskDetail.jsx';
import { TaskCard } from '../components/TaskViews.jsx';
import { Avatar, Empty, formatDate, timeAgo, todayISO } from '../components/ui.jsx';

function Stat({ label, value, tone, to }) {
  const body = (
    <>
      <div className="stat-value">{value ?? 0}</div>
      <div className="stat-label">{label}</div>
    </>
  );
  return to ? (
    <Link className={`stat ${tone || ''}`} to={to}>
      {body}
    </Link>
  ) : (
    <div className={`stat ${tone || ''}`}>{body}</div>
  );
}

export default function Dashboard() {
  const { user, version, roleLabel, isManager, t, canUseCalls } = useApp();
  const [data, setData] = useState(null);
  const [calls, setCalls] = useState(null);
  const [pendingRound, setPendingRound] = useState(null);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(() => {});
    if (canUseCalls) api.get('/calls/mine').then(setCalls).catch(() => {});
    if (user.role === 'instructor') {
      api
        .get('/centers/rounds')
        .then((r) => setPendingRound(r.rounds.find((x) => x.status === 'open' && !x.mine) || null))
        .catch(() => {});
      api.get('/centers/assignments', { instructor_id: 'me' }).then(setSessions).catch(() => {});
    }
  }, [version, canUseCalls, user.role]);

  if (!data) return <div className="muted">{t('common.loading')}</div>;
  const c = data.counts;
  const open = (c.todo || 0) + (c.in_progress || 0) + (c.blocked || 0) + (c.in_review || 0);
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'dash.morning' : hour < 18 ? 'dash.afternoon' : 'dash.evening', { name: user.name.split(' ')[0] });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting}</h1>
          <p className="muted">{user.title || roleLabel(user.role)}</p>
        </div>
      </div>

      {pendingRound && (
        <Link to="/centers?tab=mine" className="alert warning banner">
          🗓 {t('notif.availability_reminder', { title: pendingRound.title })}
          {pendingRound.due_date && <> · {t('avail.dueOn', { date: formatDate(pendingRound.due_date) })}</>} →
        </Link>
      )}

      <div className="stats">
        <Stat label={t('dash.open')} value={open} to="/tasks?scope=mine" />
        <Stat label={t('dash.inProgress')} value={c.in_progress} />
        <Stat label={t('dash.overdue')} value={data.overdue.length} tone={data.overdue.length ? 'danger' : ''} to="/tasks?scope=mine&due=overdue" />
        <Stat label={t('dash.blocked')} value={c.blocked} tone={c.blocked ? 'warn' : ''} />
        <Stat label={t('dash.toReview')} value={data.reviewQueue.length} tone={data.reviewQueue.length ? 'info' : ''} to="/tasks?scope=review" />
        <Stat label={t('dash.done')} value={c.done} tone="success" />
        {calls && <Stat label={t('dash.myCalls')} value={calls.calls.length} tone="info" to="/calls" />}
      </div>

      <div className="dash-grid">
        {data.reviewQueue.length > 0 && (
          <section className="panel">
            <h2>{t('dash.reviewQueue')}</h2>
            <div className="card-list">
              {data.reviewQueue.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </section>
        )}

        {data.overdue.length > 0 && (
          <section className="panel danger-panel">
            <h2>{t('dash.overdue')}</h2>
            <div className="card-list">
              {data.overdue.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </section>
        )}

        {sessions.length > 0 && <CenterWeek sessions={sessions} />}

        <section className="panel">
          <h2>{t('dash.upNext')}</h2>
          {data.upcoming.length ? (
            <div className="card-list">
              {data.upcoming.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <Empty>{t('dash.nothing')}</Empty>
          )}
        </section>

        <section className="panel">
          <h2>{t('dash.waiting')}</h2>
          {data.waitingOnOthers.length ? (
            <div className="card-list">
              {data.waitingOnOthers.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <Empty icon="↗">{t('dash.waitingEmpty')}</Empty>
          )}
        </section>

        {isManager && (
          <section className="panel span-2">
            <h2>{t('dash.workload')}</h2>
            {data.team.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('dash.person')}</th>
                    <th>{t('rep.open')}</th>
                    <th>{t('dash.inProgress')}</th>
                    <th>{t('dash.blocked')}</th>
                    <th>{t('dash.overdue')}</th>
                    <th>{t('dash.doneWeek')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link to={`/tasks?assignee_id=${m.id}`} className="row gap-sm">
                          <Avatar name={m.name} color={m.avatar_color} size={24} />
                          <span>
                            {m.name} <span className="muted sm">· {roleLabel(m.role)}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <WorkloadBar n={m.open} />
                      </td>
                      <td>{m.in_progress}</td>
                      <td className={m.blocked ? 'text-warn' : ''}>{m.blocked}</td>
                      <td className={m.overdue ? 'text-danger' : ''}>{m.overdue}</td>
                      <td>{m.done_week}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty icon="☷">{t('dash.noReports')}</Empty>
            )}
          </section>
        )}

        <section className="panel span-2">
          <h2>{t('dash.activity')}</h2>
          <ul className="activity">
            {data.activity.map((a) => (
              <li key={a.id}>
                <strong>{a.user_name}</strong> <ActivityText a={a} withTask /> <small className="muted">{timeAgo(a.created_at)}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const JS_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Weekly center sessions that are running this week, today's highlighted.
function CenterWeek({ sessions }) {
  const { t } = useApp();
  const now = new Date();
  const today = JS_DAY[now.getDay()];
  const iso = todayISO();
  const active = sessions.filter((s) => (!s.starts_on || s.starts_on <= iso) && (!s.ends_on || s.ends_on >= iso));
  if (!active.length) return null;
  return (
    <section className="panel">
      <h2>{t('dash.centerWeek')}</h2>
      <ul className="week-list">
        {active.map((s) => (
          <li key={s.id} className={s.day === today ? 'today' : ''}>
            <span className="week-day">{s.day === today ? t('tasks.today') : t(`day.${s.day}`)}</span>
            <span dir="ltr" className="week-time">
              {s.start_time}–{s.end_time}
            </span>
            <span className="grow">
              <strong>{s.center_name}</strong>
              {s.subject && <span className="muted"> · {s.subject}</span>}
            </span>
          </li>
        ))}
      </ul>
      <Link className="link sm" to="/centers?tab=mine">
        {t('centers.tabMine')} →
      </Link>
    </section>
  );
}

function WorkloadBar({ n }) {
  const tone = n >= 8 ? 'danger' : n >= 5 ? 'warn' : 'ok';
  return (
    <span className="workload">
      <span className={`workload-bar ${tone}`} style={{ width: `${Math.min(n, 10) * 10}%` }} />
      <span>{n}</span>
    </span>
  );
}
