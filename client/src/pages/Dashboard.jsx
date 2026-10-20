import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { ActivityText } from '../components/TaskDetail.jsx';
import { TaskCard } from '../components/TaskViews.jsx';
import { Avatar, Empty, timeAgo } from '../components/ui.jsx';

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
  const { user, version, roleLabel, isManager } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(() => {});
  }, [version]);

  if (!data) return <div className="muted">Loading…</div>;
  const c = data.counts;
  const open = (c.todo || 0) + (c.in_progress || 0) + (c.blocked || 0) + (c.in_review || 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {user.name.split(' ')[0]}
          </h1>
          <p className="muted">{user.title || roleLabel(user.role)}</p>
        </div>
      </div>

      <div className="stats">
        <Stat label="Open tasks" value={open} to="/tasks?scope=mine" />
        <Stat label="In progress" value={c.in_progress} />
        <Stat label="Overdue" value={data.overdue.length} tone={data.overdue.length ? 'danger' : ''} to="/tasks?scope=mine&due=overdue" />
        <Stat label="Blocked" value={c.blocked} tone={c.blocked ? 'warn' : ''} />
        <Stat label="To review" value={data.reviewQueue.length} tone={data.reviewQueue.length ? 'info' : ''} to="/tasks?scope=review" />
        <Stat label="Done" value={c.done} tone="success" />
      </div>

      <div className="dash-grid">
        {data.reviewQueue.length > 0 && (
          <section className="panel">
            <h2>Waiting for your review</h2>
            <div className="card-list">
              {data.reviewQueue.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </section>
        )}

        {data.overdue.length > 0 && (
          <section className="panel danger-panel">
            <h2>Overdue</h2>
            <div className="card-list">
              {data.overdue.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <h2>Up next</h2>
          {data.upcoming.length ? (
            <div className="card-list">
              {data.upcoming.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <Empty>Nothing on your plate. Nice!</Empty>
          )}
        </section>

        <section className="panel">
          <h2>Waiting on others</h2>
          {data.waitingOnOthers.length ? (
            <div className="card-list">
              {data.waitingOnOthers.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <Empty icon="↗">Tasks you've assigned to others show up here.</Empty>
          )}
        </section>

        {isManager && (
          <section className="panel span-2">
            <h2>Team workload</h2>
            {data.team.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Open</th>
                    <th>In progress</th>
                    <th>Blocked</th>
                    <th>Overdue</th>
                    <th>Done (7d)</th>
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
              <Empty icon="☷">No one reports to you yet.</Empty>
            )}
          </section>
        )}

        <section className="panel span-2">
          <h2>Recent activity</h2>
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

function WorkloadBar({ n }) {
  const tone = n >= 8 ? 'danger' : n >= 5 ? 'warn' : 'ok';
  return (
    <span className="workload">
      <span className={`workload-bar ${tone}`} style={{ width: `${Math.min(n, 10) * 10}%` }} />
      <span>{n}</span>
    </span>
  );
}
