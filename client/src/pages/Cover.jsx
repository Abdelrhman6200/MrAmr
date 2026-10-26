import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Empty, UserSelect, formatDate, todayISO } from '../components/ui.jsx';

// Everyone below `rootIds` in the org chart.
function below(users, rootIds) {
  const out = new Set();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    for (const u of users) if (u.manager_id === id && !out.has(u.id)) (out.add(u.id), stack.push(u.id));
  }
  return out;
}

// Team page, "Cover" tab: deputies acting for managers while they are away
// (ينوب عنه), and handing an absent person's open work to a colleague.
export default function Cover() {
  const { user, users, meta, isManager, isUserAdmin, covering } = useApp();
  // People this user manages, including the teams of managers they act for today.
  const managed = below(users, [user.id, ...covering.map((d) => d.user_id)]);
  managed.delete(user.id);
  const team = users.filter((u) => managed.has(u.id) && u.active !== 0);
  const isLead = (u) => meta.roles[u.role]?.level !== 'member' || users.some((x) => x.manager_id === u.id);
  // Whose deputy this user can arrange: their own (if they lead anyone) and their managers-in-team.
  const arrangeable = isUserAdmin || user.role === 'ceo' ? users.filter(isLead) : [user, ...team].filter(isLead);

  return (
    <div className="cover">
      <Deputies arrangeable={arrangeable} />
      {(isManager || team.length > 0) && <Handover team={team} />}
    </div>
  );
}

function Deputies({ arrangeable }) {
  const { user, users, delegations, t, notify, refresh } = useApp();
  const [form, setForm] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/delegations', form);
      notify(t('cover.saved'), 'success');
      setForm(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const cancel = async (d) => {
    if (!confirm(t('cover.confirmCancel', { name: d.deputy_name }))) return;
    await api.del(`/delegations/${d.id}`);
    refresh();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{t('cover.deputies')}</h2>
          <p className="muted sm">{t('cover.deputiesIntro')}</p>
        </div>
        {arrangeable.length > 0 && !form && (
          <button className="btn primary" onClick={() => setForm({ user_id: arrangeable.some((u) => u.id === user.id) ? user.id : arrangeable[0].id, deputy_id: null, starts_on: todayISO(), ends_on: todayISO(), note: '' })}>
            <Icon name="plus" size={16} /> {t('cover.add')}
          </button>
        )}
      </div>

      {form && (
        <form className="form cover-form" onSubmit={save}>
          <div className="grid-3">
            <label>
              {t('cover.person')}
              <UserSelect users={arrangeable} value={form.user_id} onChange={set('user_id')} allowEmpty={false} />
            </label>
            <label>
              {t('cover.deputy')}
              <UserSelect users={users.filter((u) => u.id !== form.user_id && u.active !== 0)} value={form.deputy_id} onChange={set('deputy_id')} placeholder={t('cover.pickDeputy')} required />
            </label>
            <label>
              {t('cover.note')}
              <input value={form.note} onChange={set('note')} placeholder={t('cover.notePh')} />
            </label>
            <label>
              {t('cover.from')}
              <input type="date" value={form.starts_on} min={todayISO()} onChange={set('starts_on')} required />
            </label>
            <label>
              {t('cover.to')}
              <input type="date" value={form.ends_on} min={form.starts_on} onChange={set('ends_on')} required />
            </label>
          </div>
          <p className="hint">{t('cover.rights')}</p>
          <div className="row gap">
            <button className="btn primary" disabled={!form.deputy_id}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {delegations.length === 0 ? (
        <Empty icon="team">{t('cover.none')}</Empty>
      ) : (
        <ul className="cover-list">
          {delegations.map((d) => (
            <li key={d.id} className={d.active ? 'active' : ''}>
              <Avatar name={d.user_name} size={30} />
              <div className="grow">
                <div>
                  <b>{d.deputy_name}</b> {t('cover.actsFor')} <b>{d.user_name}</b>
                </div>
                <div className="muted sm">
                  {formatDate(d.starts_on)} → {formatDate(d.ends_on)}
                  {d.note && <> · {d.note}</>}
                </div>
              </div>
              <span className={`pill ${d.active ? 'status-in_progress' : 'status-todo'}`}>{d.active ? t('cover.now') : t('cover.upcoming')}</span>
              {d.can_cancel && (
                <button className="icon-btn sm" onClick={() => cancel(d)} aria-label={t('cover.cancel')}>
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

function Handover({ team }) {
  const { user, t, notify, refresh, canManageCalls } = useApp();
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [what, setWhat] = useState({ tasks: true, calls: true });
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setOpen(null);
    if (from) api.get(`/delegations/open-work/${from}`).then(setOpen).catch(() => {});
  }, [from]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const moved = await api.post('/delegations/handover', { from_id: from, to_id: to, ...what });
      notify(t('cover.handedOver', moved), 'success');
      setFrom(null);
      setTo(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <section className="panel">
      <h2>{t('cover.handover')}</h2>
      <p className="muted sm">{t('cover.handoverIntro')}</p>
      <form className="form" onSubmit={submit}>
        <div className="grid-3">
          <label>
            {t('cover.handFrom')}
            <UserSelect users={team} value={from} onChange={setFrom} placeholder={t('cover.pickPerson')} />
          </label>
          <label>
            {t('cover.handTo')}
            <UserSelect users={[user, ...team].filter((u) => u.id !== from)} value={to} onChange={setTo} placeholder={t('cover.pickPerson')} />
          </label>
          <div className="cover-what">
            <label className="check">
              <input type="checkbox" checked={what.tasks} onChange={(e) => setWhat({ ...what, tasks: e.target.checked })} />
              {t('cover.openTasks', { n: open?.tasks ?? '–' })}
            </label>
            {canManageCalls && (
              <label className="check">
                <input type="checkbox" checked={what.calls} onChange={(e) => setWhat({ ...what, calls: e.target.checked })} />
                {t('cover.openCalls', { n: open?.calls ?? '–' })}
              </label>
            )}
          </div>
        </div>
        <div>
          <button className="btn primary" disabled={!from || !to || (!what.tasks && !what.calls)}>
            <Icon name="next" size={16} /> {t('cover.handoverBtn')}
          </button>
        </div>
      </form>
    </section>
  );
}
