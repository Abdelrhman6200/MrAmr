import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { DeptTag, Progress, Spinner } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

const STATUS_COLORS = { todo: '#94a3b8', in_progress: '#3b82f6', blocked: '#ef4444', in_review: '#a855f7', done: '#22c55e' };
const PRIORITY_COLORS = { urgent: '#dc2626', high: '#f97316', medium: '#eab308', low: '#94a3b8' };

function Bars({ data, colors, labels }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="hbars">
      {Object.entries(labels).map(([k, label]) => (
        <div key={k} className="hbar">
          <span className="hbar-label">{label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${((data[k] || 0) / max) * 100}%`, background: colors?.[k] || 'var(--accent)' }} />
          </span>
          <span className="hbar-value">{data[k] || 0}</span>
        </div>
      ))}
    </div>
  );
}

function Trend({ weeks }) {
  const { t } = useApp();
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.completed]));
  return (
    <div>
      <div className="trend">
        {weeks.map((w) => (
          <div key={w.week} className="trend-col" title={t('rep.weekTip', w)}>
            <div className="trend-bars">
              <span className="trend-bar created" style={{ height: `${(w.created / max) * 100}%` }} />
              <span className="trend-bar completed" style={{ height: `${(w.completed / max) * 100}%` }} />
            </div>
            <span className="muted sm">{w.week.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="legend sm">
        <span>
          <i className="sw created" /> {t('rep.created')}
        </span>
        <span>
          <i className="sw completed" /> {t('rep.completed')}
        </span>
      </div>
    </div>
  );
}

function ReportTabs() {
  const { t } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'people' ? 'people' : 'overview';
  return (
    <div className="seg">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setParams({})}>
        {t('rep.overview')}
      </button>
      <button className={tab === 'people' ? 'active' : ''} onClick={() => setParams({ tab: 'people' })}>
        {t('rep.people')}
      </button>
    </div>
  );
}

export default function Reports() {
  const [params] = useSearchParams();
  return params.get('tab') === 'people' ? <People /> : <Overview />;
}

const pctClass = (n) => (n == null ? '' : n >= 80 ? 'good' : n >= 50 ? 'ok' : 'bad');

// Performance per person over the last N days.
function People() {
  const { t, roleLabel, version } = useApp();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/dashboard/kpis', { days }).then(setData).catch(() => setData({ people: [] }));
  }, [days, version]);
  const hasCalls = data?.people.some((p) => p.calls);
  const hasComplaints = data?.people.some((p) => p.complaints_closed);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('rep.title')}</h1>
          <p className="muted">{t('rep.peopleIntro')}</p>
        </div>
        <div className="row gap">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {t('rep.lastDays', { n: d })}
              </option>
            ))}
          </select>
          <ReportTabs />
        </div>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <section className="panel flush">
          <div className="table-wrap">
            <table className="table kpis">
              <thead>
                <tr>
                  <th>{t('rep.person')}</th>
                  <th>{t('rep.done')}</th>
                  <th>{t('rep.onTime')}</th>
                  <th>{t('rep.avgDays')}</th>
                  <th>{t('rep.openNow')}</th>
                  <th>{t('rep.lateNow')}</th>
                  {hasCalls && <th>{t('rep.reach')}</th>}
                  {hasComplaints && <th>{t('rep.complaintHours')}</th>}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/tasks?assignee_id=${p.id}`} className="cell-title">
                        {p.name}
                      </Link>
                      <div className="muted sm">{roleLabel(p.role)}</div>
                    </td>
                    <td>{p.done}</td>
                    <td className={`kpi ${pctClass(p.on_time_pct)}`}>{p.on_time_pct != null ? `${p.on_time_pct}%` : '—'}</td>
                    <td>{p.avg_days ?? '—'}</td>
                    <td>{p.open}</td>
                    <td className={p.overdue ? 'kpi bad' : ''}>{p.overdue}</td>
                    {hasCalls && <td className={`kpi ${pctClass(p.reach_pct)}`}>{p.calls ? `${p.reach_pct}% (${p.calls})` : '—'}</td>}
                    {hasComplaints && <td>{p.complaint_hours != null ? t('rep.hoursN', { n: p.complaint_hours }) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Overview() {
  const { meta, version, t, statusLabel, priorityLabel, typeLabel } = useApp();
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/dashboard/reports').then(setData);
  }, [version]);
  if (!data) return <Spinner />;

  const label = (list, fn) => Object.fromEntries(list.map((x) => [x.key, fn(x.key)]));
  const done = data.byStatus.done || 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('rep.title')}</h1>
          <p className="muted">{t('rep.basis', { n: data.total })}</p>
        </div>
        <ReportTabs />
      </div>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{data.total}</div>
          <div className="stat-label">
            <span className="stat-icon">
              <Icon name="tasks" size={15} />
            </span>
            {t('rep.total')}
          </div>
        </div>
        <div className="stat success">
          <div className="stat-value">{data.total ? Math.round((done / data.total) * 100) : 0}%</div>
          <div className="stat-label">
            <span className="stat-icon">
              <Icon name="done" size={15} />
            </span>
            {t('rep.completion')}
          </div>
        </div>
        <div className="stat danger">
          <div className="stat-value">{data.byDepartment.reduce((s, d) => s + d.overdue, 0)}</div>
          <div className="stat-label">
            <span className="stat-icon">
              <Icon name="clock" size={15} />
            </span>
            {t('rep.overdue')}
          </div>
        </div>
        <div className="stat warn">
          <div className="stat-value">{data.byStatus.blocked || 0}</div>
          <div className="stat-label">
            <span className="stat-icon">
              <Icon name="ban" size={15} />
            </span>
            {t('rep.blocked')}
          </div>
        </div>
      </div>
      <div className="dash-grid">
        <section className="panel span-2">
          <h2>{t('rep.byDept')}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t('rep.department')}</th>
                <th>{t('rep.totalCol')}</th>
                <th>{t('rep.open')}</th>
                <th>{t('rep.blocked')}</th>
                <th>{t('rep.overdue')}</th>
                <th style={{ width: '30%' }}>{t('rep.completionCol')}</th>
              </tr>
            </thead>
            <tbody>
              {data.byDepartment.map((d) => (
                <tr key={d.department}>
                  <td>
                    <DeptTag department={d.department} />
                  </td>
                  <td>{d.total}</td>
                  <td>{d.open}</td>
                  <td className={d.blocked ? 'text-warn' : ''}>{d.blocked}</td>
                  <td className={d.overdue ? 'text-danger' : ''}>{d.overdue}</td>
                  <td>
                    <div className="row gap-sm">
                      <Progress value={d.done} total={d.total} color={meta.departments[d.department].color} />
                      <span className="sm">{Math.round((d.done / d.total) * 100)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h2>{t('rep.status')}</h2>
          <Bars data={data.byStatus} colors={STATUS_COLORS} labels={label(meta.statuses, statusLabel)} />
        </section>
        <section className="panel">
          <h2>{t('rep.priority')}</h2>
          <Bars data={data.byPriority} colors={PRIORITY_COLORS} labels={label(meta.priorities, priorityLabel)} />
        </section>
        <section className="panel">
          <h2>{t('rep.throughput')}</h2>
          <Trend weeks={data.weeks} />
        </section>
        <section className="panel">
          <h2>{t('rep.byType')}</h2>
          <Bars data={data.byType} labels={Object.fromEntries(meta.taskTypes.filter((x) => data.byType[x.key]).map((x) => [x.key, typeLabel(x.key)]))} />
        </section>
        <section className="panel span-2">
          <h2>{t('rep.health')}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t('rep.project')}</th>
                <th>{t('rep.department')}</th>
                <th>{t('rep.tasks')}</th>
                <th>{t('rep.overdue')}</th>
                <th style={{ width: '30%' }}>{t('rep.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.id}`}>
                      <span style={{ color: p.color }}>● </span>
                      {p.name}
                    </Link>
                  </td>
                  <td>
                    <DeptTag department={p.department} />
                  </td>
                  <td>
                    {p.done}/{p.total}
                  </td>
                  <td className={p.overdue ? 'text-danger' : ''}>{p.overdue}</td>
                  <td>
                    <Progress value={p.done} total={p.total} color={p.color} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
