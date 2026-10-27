import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Empty, Spinner, TrackPicker, TrackTag, TypeOptions, TypeTag, UserSelect, formatDate } from '../components/ui.jsx';

const blank = (user) => ({ title: '', description: '', type: 'general', priority: 'medium', assignee_id: user.id, reviewer_id: null, track: '', frequency: 'weekly', weekday: 0, month_day: 1 });

// Work that repeats: each day, week or month it becomes a task of its own,
// with its type's SOP as the checklist.
export default function Recurring() {
  const { user, meta, version, refresh, t, notify } = useApp();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);

  useEffect(() => {
    api.get('/recurring').then(setRows).catch(() => setRows([]));
  }, [version]);

  const when = (r) =>
    r.frequency === 'daily' ? t('rec.everyDay') : r.frequency === 'weekly' ? t('rec.everyWeek', { day: t(`day.${meta.weekdays[r.weekday]}`) }) : t('rec.everyMonth', { day: r.month_day });

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api.patch(`/recurring/${form.id}`, form);
      else await api.post('/recurring', form);
      notify(t('rec.saved'), 'success');
      setForm(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const toggle = (r) => api.patch(`/recurring/${r.id}`, { active: !r.active }).then(refresh, (err) => notify(err.message, 'error'));
  const remove = async (r) => {
    if (!confirm(t('rec.confirmDelete', { title: r.title }))) return;
    await api.del(`/recurring/${r.id}`).then(refresh, (err) => notify(err.message, 'error'));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('rec.title')}</h1>
          <p className="muted">{t('rec.intro')}</p>
        </div>
        {!form && (
          <button className="btn primary" onClick={() => setForm(blank(user))}>
            <Icon name="plus" size={16} /> {t('rec.new')}
          </button>
        )}
      </div>
      {form && <RecurringForm form={form} setForm={setForm} onSubmit={save} />}
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon="calendar">{t('rec.none')}</Empty>
      ) : (
        <section className="panel flush">
          <ul className="rec-list">
            {rows.map((r) => (
              <li key={r.id} className={r.active ? '' : 'paused'}>
                <div className="grow">
                  <div className="rec-title">
                    {r.title} <TypeTag type={r.type} /> <TrackTag track={r.track} />
                  </div>
                  <div className="muted sm">
                    <Icon name="calendar" size={13} /> {when(r)}
                    {r.active ? r.next_due && <> · {t('rec.next', { date: formatDate(r.next_due) })}</> : <> · {t('rec.paused')}</>}
                    {r.reviewer_name && <> · {t('rec.reviewer', { name: r.reviewer_name })}</>}
                  </div>
                </div>
                <Avatar name={r.assignee_name} color={r.assignee_color} size={28} title={r.assignee_name} />
                {r.can_manage && (
                  <div className="row gap">
                    <button className="btn sm" onClick={() => setForm({ ...r })}>
                      {t('common.edit')}
                    </button>
                    <button className="btn sm" onClick={() => toggle(r)}>
                      {r.active ? t('rec.pause') : t('rec.resume')}
                    </button>
                    <button className="icon-btn sm" onClick={() => remove(r)} aria-label={t('rec.delete')}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RecurringForm({ form, setForm, onSubmit }) {
  const { meta, users, t, priorityLabel } = useApp();
  const [assignable, setAssignable] = useState([]);
  useEffect(() => {
    api.get('/users/assignable').then(setAssignable).catch(() => {});
  }, []);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  return (
    <form className="panel form rec-form" onSubmit={onSubmit}>
      <label>
        {t('form.title')}
        <input value={form.title} onChange={set('title')} placeholder={t('rec.titlePh')} required autoFocus />
      </label>
      <div className="grid-3">
        <label>
          {t('form.type')}
          <select value={form.type} onChange={set('type')}>
            <TypeOptions current={form.type} />
          </select>
        </label>
        <label>
          {t('form.assignee')}
          <UserSelect users={assignable} value={form.assignee_id} onChange={set('assignee_id')} allowEmpty={false} />
        </label>
        <label>
          {t('form.reviewer')}
          <UserSelect users={users} value={form.reviewer_id} onChange={set('reviewer_id')} placeholder={t('form.noReview')} />
        </label>
        <label>
          {t('rec.frequency')}
          <select value={form.frequency} onChange={set('frequency')}>
            {['daily', 'weekly', 'monthly'].map((f) => (
              <option key={f} value={f}>
                {t(`rec.${f}`)}
              </option>
            ))}
          </select>
        </label>
        {form.frequency === 'weekly' && (
          <label>
            {t('rec.weekday')}
            <select value={form.weekday} onChange={(e) => set('weekday')(Number(e.target.value))}>
              {meta.weekdays.map((d, i) => (
                <option key={d} value={i}>
                  {t(`day.${d}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {form.frequency === 'monthly' && (
          <label>
            {t('rec.monthDay')}
            <input type="number" min="1" max="31" value={form.month_day} onChange={(e) => set('month_day')(Number(e.target.value))} />
          </label>
        )}
        <label>
          {t('form.priority')}
          <select value={form.priority} onChange={set('priority')}>
            {meta.priorities.map((p) => (
              <option key={p.key} value={p.key}>
                {priorityLabel(p.key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('form.track')}
          <TrackPicker value={form.track} onChange={set('track')} />
        </label>
      </div>
      <label>
        {t('form.description')}
        <textarea rows={2} value={form.description || ''} onChange={set('description')} />
      </label>
      <p className="hint">{t('rec.hint')}</p>
      <div className="row gap">
        <button className="btn primary">{t('common.save')}</button>
        <button type="button" className="btn" onClick={() => setForm(null)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
