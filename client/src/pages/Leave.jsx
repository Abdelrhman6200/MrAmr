import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Empty, Spinner, UserSelect, formatDate, todayISO } from '../components/ui.jsx';

const KINDS = ['annual', 'sick', 'other'];

function useLeave() {
  const { version } = useApp();
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/leave').then(setData).catch(() => setData({ mine: [], team: [], off_today: [] }));
  }, [version]);
  return data;
}

const statusClass = { pending: 'status-todo', approved: 'status-done', rejected: 'status-blocked' };

// Settings: ask for leave and follow your requests.
export function MyLeave() {
  const { user, users, meta, t, notify, refresh } = useApp();
  const data = useLeave();
  const [form, setForm] = useState(null);
  const leads = meta.roles[user.role]?.level !== 'member' || users.some((u) => u.manager_id === user.id);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/leave', form);
      notify(t('leave.sent'), 'success');
      setForm(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const cancel = (l) => api.del(`/leave/${l.id}`).then(refresh, (err) => notify(err.message, 'error'));

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{t('leave.title')}</h2>
          <p className="muted sm">{t('leave.hint')}</p>
        </div>
        {!form && (
          <button className="btn" onClick={() => setForm({ kind: 'annual', starts_on: todayISO(), ends_on: todayISO(), note: '', deputy_id: null })}>
            <Icon name="plus" size={15} /> {t('leave.ask')}
          </button>
        )}
      </div>
      {form && (
        <form className="form cover-form" onSubmit={save}>
          <div className="grid-3">
            <label>
              {t('leave.kind')}
              <select value={form.kind} onChange={set('kind')}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`leave.kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('cover.from')}
              <input type="date" value={form.starts_on} min={todayISO()} onChange={set('starts_on')} required />
            </label>
            <label>
              {t('cover.to')}
              <input type="date" value={form.ends_on} min={form.starts_on} onChange={set('ends_on')} required />
            </label>
            {leads && (
              <label>
                {t('leave.deputy')}
                <UserSelect users={users.filter((u) => u.id !== user.id)} value={form.deputy_id} onChange={set('deputy_id')} placeholder={t('leave.noDeputy')} />
              </label>
            )}
            <label>
              {t('cover.note')}
              <input value={form.note} onChange={set('note')} />
            </label>
          </div>
          <div className="row gap">
            <button className="btn primary">{t('leave.send')}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
      {data?.mine.length > 0 && (
        <ul className="cover-list">
          {data.mine.map((l) => (
            <li key={l.id}>
              <div className="grow">
                <div>
                  {t(`leave.kind.${l.kind}`)} · {formatDate(l.starts_on)} → {formatDate(l.ends_on)}
                </div>
                <div className="muted sm">
                  {[l.deputy_name && t('leave.deputyIs', { name: l.deputy_name }), l.decided_by_name && t('leave.decidedBy', { name: l.decided_by_name }), l.decision_note].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className={`pill ${statusClass[l.status]}`}>{t(`leave.status.${l.status}`)}</span>
              {(l.status === 'pending' || l.starts_on > todayISO()) && (
                <button className="icon-btn sm" onClick={() => cancel(l)} aria-label={t('leave.cancel')}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Team → Leave: requests waiting on you, and who is off today.
export function TeamLeave() {
  const { t, notify, refresh } = useApp();
  const data = useLeave();
  if (!data) return <Spinner />;
  const decide = async (l, decision) => {
    const note = decision === 'reject' ? prompt(t('leave.why')) ?? '' : '';
    try {
      await api.post(`/leave/${l.id}/decide`, { decision, note });
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <div className="cover">
      <section className="panel">
        <h2>{t('leave.offToday')}</h2>
        {data.off_today.length === 0 ? (
          <p className="muted">{t('leave.nobodyOff')}</p>
        ) : (
          <div className="row gap wrap">
            {data.off_today.map((l) => (
              <span key={l.id} className="person-chip">
                <Avatar name={l.user_name} color={l.avatar_color} size={24} /> {l.user_name}
                <span className="muted sm"> · {t(`leave.kind.${l.kind}`)} → {formatDate(l.ends_on)}</span>
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>{t('leave.requests')}</h2>
        {data.team.length === 0 ? (
          <Empty icon="calendar">{t('leave.noRequests')}</Empty>
        ) : (
          <ul className="cover-list">
            {data.team.map((l) => (
              <li key={l.id} className={l.status === 'pending' ? 'active' : ''}>
                <Avatar name={l.user_name} color={l.avatar_color} size={30} />
                <div className="grow">
                  <div>
                    <b>{l.user_name}</b> · {t(`leave.kind.${l.kind}`)} · {formatDate(l.starts_on)} → {formatDate(l.ends_on)}
                  </div>
                  <div className="muted sm">{[l.deputy_name && t('leave.deputyIs', { name: l.deputy_name }), l.note].filter(Boolean).join(' · ')}</div>
                </div>
                {l.status === 'pending' && l.can_decide ? (
                  <div className="row gap">
                    <button className="btn sm success" onClick={() => decide(l, 'approve')}>
                      {t('leave.approve')}
                    </button>
                    <button className="btn sm" onClick={() => decide(l, 'reject')}>
                      {t('leave.reject')}
                    </button>
                  </div>
                ) : (
                  <span className={`pill ${statusClass[l.status]}`}>{t(`leave.status.${l.status}`)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Team → Shifts: each person's weekly hours; managers edit their team's.
export function Shifts() {
  const { user, users, meta, t, version, refresh, notify, isManager } = useApp();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    api.get('/shifts').then(setData).catch(() => setData({ shifts: [], on_today: [], today: 0 }));
  }, [version]);
  if (!data) return <Spinner />;
  const days = meta.weekdays;
  const people = [...new Map(data.shifts.map((s) => [s.user_id, { id: s.user_id, name: s.user_name, color: s.avatar_color }])).values()];
  const save = async () => {
    try {
      await api.put(`/shifts/${editing.user_id}`, { shifts: editing.shifts });
      setEditing(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const mine = users.filter((u) => u.manager_id === user.id || u.id === user.id);

  return (
    <div className="cover">
      <section className="panel">
        <h2>{t('shifts.today', { day: t(`day.${days[data.today]}`) })}</h2>
        {data.on_today.length === 0 ? (
          <p className="muted">{t('shifts.noneToday')}</p>
        ) : (
          <div className="row gap wrap">
            {data.on_today.map((s) => (
              <span key={s.id} className="person-chip">
                <Avatar name={s.user_name} color={s.avatar_color} size={24} /> {s.user_name}
                <span className="muted sm" dir="ltr">
                  {' '}
                  {s.start_time}–{s.end_time}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('shifts.week')}</h2>
          {isManager && !editing && (
            <select value="" onChange={(e) => e.target.value && setEditing({ user_id: Number(e.target.value), shifts: data.shifts.filter((s) => s.user_id === Number(e.target.value)).map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time })) })}>
              <option value="">{t('shifts.edit')}</option>
              {mine.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {editing && (
          <div className="form cover-form">
            <b>{users.find((u) => u.id === editing.user_id)?.name}</b>
            {editing.shifts.map((s, i) => (
              <div key={i} className="row gap">
                <select value={s.weekday} onChange={(e) => setEditing({ ...editing, shifts: editing.shifts.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)) })}>
                  {days.map((d, k) => (
                    <option key={d} value={k}>
                      {t(`day.${d}`)}
                    </option>
                  ))}
                </select>
                <input type="time" value={s.start_time} onChange={(e) => setEditing({ ...editing, shifts: editing.shifts.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)) })} />
                <input type="time" value={s.end_time} onChange={(e) => setEditing({ ...editing, shifts: editing.shifts.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)) })} />
                <button type="button" className="icon-btn sm" onClick={() => setEditing({ ...editing, shifts: editing.shifts.filter((_, j) => j !== i) })} aria-label={t('task.removeItem')}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <div className="row gap">
              <button type="button" className="btn sm" onClick={() => setEditing({ ...editing, shifts: [...editing.shifts, { weekday: 0, start_time: '09:00', end_time: '17:00' }] })}>
                <Icon name="plus" size={14} /> {t('shifts.add')}
              </button>
              <button type="button" className="btn primary sm" onClick={save}>
                {t('common.save')}
              </button>
              <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
        {people.length === 0 ? (
          <Empty icon="calendar">{t('shifts.none')}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table shifts">
              <thead>
                <tr>
                  <th />
                  {days.map((d, i) => (
                    <th key={d} className={i === data.today ? 'today' : ''}>
                      {t(`day.${d}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="row gap-sm">
                        <Avatar name={p.name} color={p.color} size={22} /> {p.name}
                      </span>
                    </td>
                    {days.map((d, i) => (
                      <td key={d} className={i === data.today ? 'today' : ''} dir="ltr">
                        {data.shifts
                          .filter((s) => s.user_id === p.id && s.weekday === i)
                          .map((s) => `${s.start_time}–${s.end_time}`)
                          .join(', ') || <span className="muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
