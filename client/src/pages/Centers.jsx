import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, Empty, Modal, formatDate, timeAgo } from '../components/ui.jsx';

const WARNINGS = ['center_full', 'no_availability', 'outside_availability', 'max_sessions'];
const overlaps = (a, b) => a.start_time < b.end_time && b.start_time < a.end_time;

function useCenterAdmin() {
  const { user, meta } = useApp();
  return meta.centerAdminRoles.includes(user.role);
}

const covers = (slots, day, start, end) => (slots || []).some((s) => s.day === day && s.start <= start && s.end >= end);

// ---------------------------------------------------------------------------
function CenterModal({ center, onClose, onSaved }) {
  const { t, notify } = useApp();
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    name: center?.name || '',
    city: center?.city || '',
    address: center?.address || '',
    phone: center?.phone || '',
    contact_name: center?.contact_name || '',
    capacity: center?.capacity ?? 2,
    notes: center?.notes || '',
    active: center ? !!center.active : true,
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...form, capacity: Number(form.capacity) };
      if (center) await api.patch(`/centers/${center.id}`, body);
      else await api.post('/centers', body);
      notify(t('centers.saved'), 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      title={center ? t('centers.editTitle') : t('centers.addTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="center-form">
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="center-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('centers.name')}
          <input required autoFocus value={form.name} onChange={set('name')} />
        </label>
        <div className="grid-2">
          <label>
            {t('centers.city')}
            <input value={form.city} onChange={set('city')} />
          </label>
          <label>
            {t('centers.capacity')} <span className="hint">{t('centers.capacityHint')}</span>
            <input type="number" min="1" max="100" required value={form.capacity} onChange={set('capacity')} />
          </label>
        </div>
        <label>
          {t('centers.address')}
          <input value={form.address} onChange={set('address')} />
        </label>
        <div className="grid-2">
          <label>
            {t('centers.phone')}
            <input value={form.phone} onChange={set('phone')} dir="ltr" />
          </label>
          <label>
            {t('centers.contact')}
            <input value={form.contact_name} onChange={set('contact_name')} />
          </label>
        </div>
        <label>
          {t('centers.notes')}
          <textarea rows={2} value={form.notes} onChange={set('notes')} />
        </label>
        {center && (
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={set('active')} /> {t('centers.activeLabel')}
          </label>
        )}
      </form>
    </Modal>
  );
}

function SessionModal({ initial, centers, rounds, assignments, onClose, onSaved }) {
  const { t, notify, users } = useApp();
  const existing = initial.id ? initial : null;
  const defaultRound = rounds.find((r) => r.status === 'open') || rounds[0];
  const [form, setForm] = useState(() => ({
    center_id: initial.center_id ?? centers[0]?.id ?? '',
    day: initial.day ?? 'sat',
    start_time: initial.start_time ?? '10:00',
    end_time: initial.end_time ?? '12:00',
    instructor_id: initial.instructor_id ?? '',
    subject: initial.subject ?? '',
    starts_on: initial.starts_on ?? defaultRound?.starts_on ?? '',
    ends_on: initial.ends_on ?? defaultRound?.ends_on ?? '',
    round_id: initial.round_id ?? defaultRound?.id ?? '',
    notes: initial.notes ?? '',
  }));
  const [round, setRound] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    setRound(null);
    if (form.round_id) api.get(`/centers/rounds/${form.round_id}`).then(setRound).catch(() => {});
  }, [form.round_id]);
  useEffect(() => setProblem(null), [JSON.stringify(form)]);

  const instructors = round?.instructors || users.filter((u) => u.role === 'instructor').map((u) => ({ ...u, availability: null }));
  const centerId = Number(form.center_id);
  const statusOf = (inst) => {
    const clash = assignments.find((a) => a.instructor_id === inst.id && a.id !== existing?.id && a.day === form.day && overlaps(a, form));
    if (clash) return { key: 'busy', rank: 3 };
    if (!round) return { key: null, rank: 1 };
    if (!inst.availability) return { key: 'noSubmission', rank: 2 };
    return covers(inst.availability.slots, form.day, form.start_time, form.end_time) ? { key: 'available', rank: 0 } : { key: 'notAvailable', rank: 2 };
  };
  const options = instructors
    .map((i) => ({ ...i, status: statusOf(i), prefers: i.availability?.center_ids?.includes(centerId) }))
    .sort((a, b) => a.status.rank - b.status.rank || Number(b.prefers) - Number(a.prefers) || a.name.localeCompare(b.name));
  const chosen = options.find((o) => o.id === Number(form.instructor_id));
  const daySlots = chosen?.availability?.slots.filter((s) => s.day === form.day) || [];

  const save = async (force = false) => {
    setBusy(true);
    try {
      const body = { ...form, center_id: Number(form.center_id), instructor_id: Number(form.instructor_id) || null, round_id: form.round_id ? Number(form.round_id) : null, force };
      if (existing) await api.patch(`/centers/assignments/${existing.id}`, body);
      else await api.post('/centers/assignments', body);
      notify(t('session.saved'), 'success');
      onSaved();
    } catch (e) {
      setProblem({ code: e.code, message: e.code ? t(`assignErr.${e.code}`, e.details) : e.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t('session.confirmRemove'))) return;
    await api.del(`/centers/assignments/${existing.id}`);
    notify(t('session.deleted'));
    onSaved();
  };

  const warning = problem && WARNINGS.includes(problem.code);

  return (
    <Modal
      title={existing ? t('session.editTitle') : t('session.newTitle')}
      onClose={onClose}
      wide
      footer={
        <>
          {existing && (
            <button className="btn danger" onClick={remove}>
              {t('session.remove')}
            </button>
          )}
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {warning ? (
            <button className="btn warn" disabled={busy} onClick={() => save(true)}>
              {t('session.assignAnyway')}
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !form.instructor_id || !form.center_id} onClick={() => save(false)}>
              {existing ? t('common.save') : t('session.save')}
            </button>
          )}
        </>
      }
    >
      <div className="form">
        {problem && <div className={`alert ${warning ? 'warning' : 'error'}`}>{problem.message}</div>}
        <div className="grid-3">
          <label>
            {t('session.center')}
            <select value={form.center_id} onChange={set('center_id')}>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` — ${c.city}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('session.day')}
            <select value={form.day} onChange={set('day')}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`day.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <label>
              {t('session.start')}
              <input type="time" step="900" value={form.start_time} onChange={set('start_time')} />
            </label>
            <label>
              {t('session.end')}
              <input type="time" step="900" value={form.end_time} onChange={set('end_time')} />
            </label>
          </div>
        </div>
        <div className="grid-2">
          <label>
            {t('session.round')}
            <select value={form.round_id} onChange={set('round_id')}>
              <option value="">—</option>
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('session.instructor')}
            <select value={form.instructor_id} onChange={set('instructor_id')}>
              <option value="">{t('session.pick')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.status.key ? `  ${t(`session.${o.status.key}`)}` : ''}
                  {o.prefers ? `  ${t('session.prefers')}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {chosen && round && (
          <div className={`alert ${chosen.status.key === 'available' ? 'info' : 'warning'} sm`}>
            {t(`session.${chosen.status.key}`)} · {t('session.theirTimes', { slots: daySlots.length ? daySlots.map((s) => `${s.start}–${s.end}`).join('، ') : t('session.noTimes') })}
            {chosen.availability?.max_sessions != null && <> · {t('avail.max')}: {chosen.availability.max_sessions}</>} · {t('session.sessionsCount', { n: chosen.sessions })}
          </div>
        )}
        <label>
          {t('session.subject')}
          <input value={form.subject} onChange={set('subject')} placeholder={t('session.subjectPh')} />
        </label>
        <div className="grid-2">
          <label>
            {t('session.from')}
            <input type="date" value={form.starts_on || ''} onChange={set('starts_on')} />
          </label>
          <label>
            {t('session.until')}
            <input type="date" value={form.ends_on || ''} onChange={set('ends_on')} />
          </label>
        </div>
        <label>
          {t('centers.notes')}
          <textarea rows={2} value={form.notes} onChange={set('notes')} />
        </label>
      </div>
    </Modal>
  );
}

const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

// ---------------------------------------------------------------------------
function Schedule({ centers, rounds, assignments, reload }) {
  const { t } = useApp();
  const admin = useCenterAdmin();
  const [instructor, setInstructor] = useState('');
  const [editing, setEditing] = useState(null);
  const shown = instructor ? assignments.filter((a) => a.instructor_id === Number(instructor)) : assignments;
  const people = [...new Map(assignments.map((a) => [a.instructor_id, a.instructor_name])).entries()];

  return (
    <>
      <div className="row between wrap gap">
        <div className="filters">
          <select value={instructor} onChange={(e) => setInstructor(e.target.value)}>
            <option value="">{t('centers.allInstructors')}</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {admin && <span className="muted sm">{t('centers.scheduleHint')}</span>}
        </div>
        {admin && centers.length > 0 && (
          <button className="btn primary" onClick={() => setEditing({})}>
            {t('centers.assign')}
          </button>
        )}
      </div>
      {centers.length === 0 ? (
        <Empty icon="⌂">{t('centers.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table schedule">
            <thead>
              <tr>
                <th>{t('centers.center')}</th>
                {DAYS.map((d) => (
                  <th key={d}>{t(`day.${d}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => (
                <tr key={c.id}>
                  <th className="sched-center">
                    <div className="cell-title">{c.name}</div>
                    <div className="muted sm">
                      {c.city} · {t('centers.capacity')}: {c.capacity}
                    </div>
                  </th>
                  {DAYS.map((d) => {
                    const list = shown.filter((a) => a.center_id === c.id && a.day === d);
                    return (
                      <td key={d} className={`sched-cell ${admin ? 'editable' : ''}`} onClick={() => admin && setEditing({ center_id: c.id, day: d })}>
                        {list.map((a) => (
                          <button
                            key={a.id}
                            className="session"
                            style={{ '--c': a.instructor_color || 'var(--accent)' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (admin) setEditing(a);
                            }}
                            title={`${a.instructor_name} · ${a.subject || ''}`}
                          >
                            <span className="session-time" dir="ltr">
                              {a.start_time}–{a.end_time}
                            </span>
                            <span className="session-who">{a.instructor_name}</span>
                            {a.subject && <span className="session-subject">{a.subject}</span>}
                          </button>
                        ))}
                        {admin && list.length === 0 && <span className="sched-add">+</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <SessionModal
          initial={editing}
          centers={centers}
          rounds={rounds}
          assignments={assignments}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function CentersTable({ reload }) {
  const { t, version, notify } = useApp();
  const admin = useCenterAdmin();
  const [all, setAll] = useState(false);
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(undefined);

  useEffect(() => {
    api.get('/centers', { all: all ? '1' : '' }).then((r) => setList(r.centers));
  }, [all, version]);

  const remove = async (c) => {
    if (!confirm(t('centers.confirmDelete', { name: c.name }))) return;
    await api.del(`/centers/${c.id}`);
    notify(t('centers.deleted'));
    reload();
  };

  return (
    <>
      <div className="row between wrap gap">
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('centers.showInactive')}
        </label>
        {admin && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            {t('centers.add')}
          </button>
        )}
      </div>
      {list && list.length === 0 && <Empty icon="⌂">{t('centers.none')}</Empty>}
      {list && list.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('centers.name')}</th>
                <th>{t('centers.city')}</th>
                <th>{t('centers.address')}</th>
                <th>{t('centers.phone')}</th>
                <th>{t('centers.contact')}</th>
                <th>{t('centers.capacity')}</th>
                <th>{t('centers.sessions')}</th>
                <th>{t('centers.instructors')}</th>
                <th>{t('users.status')}</th>
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'inactive'}>
                  <td className="cell-title">{c.name}</td>
                  <td>{c.city}</td>
                  <td className="sm">{c.address}</td>
                  <td dir="ltr" className="phone-cell">
                    {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}
                  </td>
                  <td>{c.contact_name}</td>
                  <td>{c.capacity}</td>
                  <td>{c.sessions}</td>
                  <td>{c.instructor_count}</td>
                  <td>{c.active ? <span className="pill status-done">{t('centers.active')}</span> : <span className="pill status-todo">{t('centers.inactive')}</span>}</td>
                  {admin && (
                    <td className="nowrap">
                      <button className="link" onClick={() => setEditing(c)}>
                        {t('common.edit')}
                      </button>{' '}
                      <button className="link danger-link" onClick={() => remove(c)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && (
        <CenterModal
          center={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function AvailabilityEditor({ value, onChange, centers, disabled }) {
  const { t } = useApp();
  const slots = value.slots || [];
  const setSlots = (next) => onChange({ ...value, slots: next });
  const toggleCenter = (id) =>
    onChange({ ...value, center_ids: value.center_ids.includes(id) ? value.center_ids.filter((x) => x !== id) : [...value.center_ids, id] });

  return (
    <div className="form">
      <div className="avail-days">
        {DAYS.map((d) => {
          const daySlots = slots.map((s, i) => ({ ...s, i })).filter((s) => s.day === d);
          return (
            <div key={d} className={`avail-day ${daySlots.length ? 'has' : ''}`}>
              <div className="avail-day-name">{t(`day.${d}`)}</div>
              <div className="avail-day-slots">
                {daySlots.length === 0 && <span className="muted sm">{t('mine.unavailable')}</span>}
                {daySlots.map((s) => (
                  <div key={s.i} className="slot" dir="ltr">
                    <input type="time" step="900" disabled={disabled} value={s.start} onChange={(e) => setSlots(slots.map((x, j) => (j === s.i ? { ...x, start: e.target.value } : x)))} />
                    <span>–</span>
                    <input type="time" step="900" disabled={disabled} value={s.end} onChange={(e) => setSlots(slots.map((x, j) => (j === s.i ? { ...x, end: e.target.value } : x)))} />
                    {!disabled && (
                      <button type="button" className="icon-btn sm" aria-label={t('mine.removeSlot')} onClick={() => setSlots(slots.filter((_, j) => j !== s.i))}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!disabled && (
                <button type="button" className="btn sm" onClick={() => setSlots([...slots, { day: d, start: '10:00', end: '14:00' }])}>
                  {t('mine.addSlot')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <div className="field-label">{t('mine.preferred')}</div>
        <div className="agent-picks">
          {centers.map((c) => (
            <label key={c.id} className="check chip-check">
              <input type="checkbox" disabled={disabled} checked={value.center_ids.includes(c.id)} onChange={() => toggleCenter(c.id)} /> {c.name}
              {c.city && <span className="muted sm"> · {c.city}</span>}
            </label>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label>
          {t('mine.max')}
          <input type="number" min="0" max="50" disabled={disabled} value={value.max_sessions ?? ''} onChange={(e) => onChange({ ...value, max_sessions: e.target.value })} />
        </label>
        <label>
          {t('mine.notes')}
          <input disabled={disabled} value={value.notes || ''} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

const emptyAvailability = () => ({ slots: [], center_ids: [], max_sessions: '', notes: '' });
const slotsValid = (slots) => slots.every((s) => s.start && s.end && s.end > s.start);

function RoundModal({ onClose, onSaved }) {
  const { t, notify } = useApp();
  const [form, setForm] = useState({ title: '', starts_on: '', ends_on: '', due_date: '', notes: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/centers/rounds', form);
      notify(t('avail.created'), 'success');
      onSaved(r.id);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal
      title={t('avail.newRoundTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="round-form">
            {t('avail.create')}
          </button>
        </>
      }
    >
      <form id="round-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('avail.roundTitle')}
          <input required autoFocus value={form.title} onChange={set('title')} placeholder={t('avail.roundTitlePh')} />
        </label>
        <div className="grid-3">
          <label>
            {t('avail.periodStart')}
            <input type="date" value={form.starts_on} onChange={set('starts_on')} />
          </label>
          <label>
            {t('avail.periodEnd')}
            <input type="date" value={form.ends_on} onChange={set('ends_on')} />
          </label>
          <label>
            {t('avail.due')}
            <input type="date" value={form.due_date} onChange={set('due_date')} />
          </label>
        </div>
        <label>
          {t('avail.notes')}
          <textarea rows={2} value={form.notes} onChange={set('notes')} />
        </label>
      </form>
    </Modal>
  );
}

function OnBehalfModal({ round, instructor, centers, onClose, onSaved }) {
  const { t, notify } = useApp();
  const [value, setValue] = useState(() => (instructor.availability ? { ...instructor.availability } : emptyAvailability()));
  const [error, setError] = useState('');
  const save = async () => {
    try {
      await api.put(`/centers/rounds/${round.id}/availability/${instructor.id}`, value);
      notify(t('mine.saved'), 'success');
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Modal
      title={t('avail.forTitle', { name: instructor.name })}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!slotsValid(value.slots)} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      <AvailabilityEditor value={value} onChange={setValue} centers={centers} />
    </Modal>
  );
}

function Availability({ centers, rounds, reloadRounds }) {
  const { t, version, refresh, notify } = useApp();
  const [roundId, setRoundId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const current = roundId ?? rounds[0]?.id;

  useEffect(() => {
    if (current) api.get(`/centers/rounds/${current}`).then(setDetail);
    else setDetail(null);
  }, [current, version]);

  const centerName = (id) => centers.find((c) => c.id === id)?.name;
  const missing = detail ? detail.instructors.filter((i) => !i.availability).length : 0;

  const setStatus = async (status) => {
    await api.patch(`/centers/rounds/${current}`, { status });
    refresh();
    reloadRounds();
  };
  const remind = async () => {
    const r = await api.post(`/centers/rounds/${current}/remind`);
    notify(t('avail.reminded', { n: r.reminded }), 'success');
  };

  return (
    <>
      <div className="row between wrap gap">
        <div className="round-chips">
          {rounds.map((r) => (
            <button key={r.id} className={`status-chip ${r.id === current ? 'active' : ''}`} onClick={() => setRoundId(r.id)}>
              <span className={`pill ${r.status === 'open' ? 'status-done' : 'status-todo'}`}>{t(r.status === 'open' ? 'avail.open' : 'avail.closed')}</span>
              <strong>{r.title}</strong>
              <span className="muted sm">{t('avail.submittedCount', { submitted: r.submitted, total: r.total })}</span>
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          {t('avail.newRound')}
        </button>
      </div>

      {rounds.length === 0 && <Empty icon="🗓">{t('avail.noRounds')}</Empty>}

      {detail && (
        <section className="panel">
          <div className="row between wrap gap">
            <div>
              <h2 style={{ marginBottom: 2 }}>{detail.title}</h2>
              <div className="muted sm">
                {detail.starts_on && `${formatDate(detail.starts_on)} → ${formatDate(detail.ends_on)} · `}
                {detail.due_date && t('avail.dueOn', { date: formatDate(detail.due_date) })}
              </div>
              {detail.notes && <p className="muted sm">{detail.notes}</p>}
            </div>
            <div className="row gap wrap">
              {detail.status === 'open' && missing > 0 && (
                <button className="btn" onClick={remind}>
                  🔔 {t('avail.remind', { n: missing })}
                </button>
              )}
              <button className="btn" onClick={() => setStatus(detail.status === 'open' ? 'closed' : 'open')}>
                {detail.status === 'open' ? t('avail.close') : t('avail.reopen')}
              </button>
            </div>
          </div>
          <div className="table-wrap flat">
            <table className="table avail-table">
              <thead>
                <tr>
                  <th>{t('avail.instructor')}</th>
                  <th>{t('avail.status')}</th>
                  {DAYS.map((d) => (
                    <th key={d}>{t(`day.${d}`)}</th>
                  ))}
                  <th>{t('avail.preferred')}</th>
                  <th>{t('avail.max')}</th>
                  <th>{t('avail.assigned')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.instructors.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="row gap-sm">
                        <Avatar name={i.name} color={i.avatar_color} size={22} /> {i.name}
                      </span>
                    </td>
                    <td>
                      {i.availability ? (
                        <span className="pill status-done" title={timeAgo(i.availability.submitted_at)}>
                          {t('avail.submitted')}
                        </span>
                      ) : (
                        <span className="pill call-no_answer">{t('avail.missing')}</span>
                      )}
                    </td>
                    {DAYS.map((d) => {
                      const s = i.availability?.slots.filter((x) => x.day === d) || [];
                      return (
                        <td key={d} className={`avail-cell ${s.length ? 'on' : ''}`} dir="ltr">
                          {s.map((x) => (
                            <div key={`${x.start}${x.end}`}>
                              {x.start}–{x.end}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                    <td className="sm">{i.availability?.center_ids.map(centerName).filter(Boolean).join('، ')}</td>
                    <td>{i.availability?.max_sessions ?? ''}</td>
                    <td>{i.sessions}</td>
                    <td>
                      <button className="link" onClick={() => setEditing(i)}>
                        {i.availability ? t('avail.editFor') : t('avail.enterFor')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {creating && (
        <RoundModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setRoundId(id);
            reloadRounds();
          }}
        />
      )}
      {editing && detail && (
        <OnBehalfModal
          round={detail}
          instructor={editing}
          centers={centers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
            reloadRounds();
          }}
        />
      )}
    </>
  );
}

function Mine({ centers, rounds, assignments, reloadRounds }) {
  const { t, user, notify } = useApp();
  const openRounds = rounds.filter((r) => r.status === 'open');
  const [roundId, setRoundId] = useState(null);
  const current = rounds.find((r) => r.id === roundId) || openRounds[0];
  const [value, setValue] = useState(emptyAvailability);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const mine = assignments.filter((a) => a.instructor_id === user.id);

  useEffect(() => {
    if (!current) return;
    api.get(`/centers/rounds/${current.id}/mine`).then((r) => {
      setSaved(r.availability);
      setValue(r.availability ? { ...r.availability, max_sessions: r.availability.max_sessions ?? '' } : emptyAvailability());
    });
  }, [current?.id]);

  const submit = async () => {
    setError('');
    try {
      const r = await api.put(`/centers/rounds/${current.id}/mine`, value);
      setSaved(r);
      notify(t('mine.saved'), 'success');
      reloadRounds();
    } catch (e) {
      setError(e.message);
    }
  };

  const closed = current?.status !== 'open';
  return (
    <>
      <section className="panel">
        <div className="row between wrap gap">
          <div>
            <h2 style={{ marginBottom: 2 }}>
              {t('mine.title')}
              {current && ` — ${current.title}`}
            </h2>
            {current?.due_date && <div className="muted sm">{t('avail.dueOn', { date: formatDate(current.due_date) })}</div>}
            {current?.notes && <p className="muted sm">{current.notes}</p>}
          </div>
          {rounds.length > 1 && (
            <select value={current?.id ?? ''} onChange={(e) => setRoundId(Number(e.target.value))}>
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({t(r.status === 'open' ? 'avail.open' : 'avail.closed')})
                </option>
              ))}
            </select>
          )}
        </div>
        {!current ? (
          <Empty icon="🗓">{t('mine.noRound')}</Empty>
        ) : (
          <>
            {closed ? <div className="alert info sm">{t('mine.closed')}</div> : <p className="muted">{t('mine.explain')}</p>}
            {error && <div className="alert error">{error}</div>}
            <AvailabilityEditor value={value} onChange={setValue} centers={centers} disabled={closed} />
            {!closed && (
              <div className="row gap wrap" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!slotsValid(value.slots)} onClick={submit}>
                  {saved ? t('mine.update') : t('mine.submit')}
                </button>
                {saved && <span className="muted sm">{t('mine.lastSaved', { when: timeAgo(saved.submitted_at) })}</span>}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel">
        <h2>{t('mine.sessions')}</h2>
        {mine.length === 0 ? (
          <Empty icon="⌂">{t('mine.noSessions')}</Empty>
        ) : (
          <div className="table-wrap flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('session.day')}</th>
                  <th>{t('session.start')}</th>
                  <th>{t('session.center')}</th>
                  <th>{t('centers.address')}</th>
                  <th>{t('session.subject')}</th>
                  <th>{t('session.from')}</th>
                  <th>{t('session.until')}</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((a) => {
                  const c = centers.find((x) => x.id === a.center_id);
                  return (
                    <tr key={a.id}>
                      <td className="cell-title">{t(`day.${a.day}`)}</td>
                      <td dir="ltr" className="phone-cell">
                        {a.start_time}–{a.end_time}
                      </td>
                      <td>{a.center_name}</td>
                      <td className="sm">
                        {c?.address}
                        {c?.city && ` · ${c.city}`}
                      </td>
                      <td>{a.subject}</td>
                      <td>{formatDate(a.starts_on)}</td>
                      <td>{formatDate(a.ends_on)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
export default function Centers() {
  const { t, user, version, refresh } = useApp();
  const admin = useCenterAdmin();
  const isInstructor = user.role === 'instructor';
  const [params, setParams] = useSearchParams();
  const [centers, setCenters] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const loadRounds = () => api.get('/centers/rounds').then((r) => setRounds(r.rounds));
  useEffect(() => {
    Promise.all([api.get('/centers'), api.get('/centers/assignments'), loadRounds()]).then(([c, a]) => {
      setCenters(c.centers);
      setAssignments(a);
      setLoaded(true);
    });
  }, [version]);

  const tabs = useMemo(
    () => [isInstructor && 'mine', 'schedule', 'centers', admin && 'availability'].filter(Boolean),
    [isInstructor, admin],
  );
  const tab = tabs.includes(params.get('tab')) ? params.get('tab') : tabs[0];
  const setTab = (k) => setParams({ tab: k });
  const label = { mine: 'centers.tabMine', schedule: 'centers.tabSchedule', centers: 'centers.tabCenters', availability: 'centers.tabAvailability' };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('centers.title')}</h1>
          <p className="muted">{t('centers.subtitle')}</p>
        </div>
        <div className="seg">
          {tabs.map((k) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {t(label[k])}
            </button>
          ))}
        </div>
      </div>
      {!loaded ? (
        <div className="muted">{t('common.loading')}</div>
      ) : tab === 'mine' ? (
        <Mine centers={centers} rounds={rounds} assignments={assignments} reloadRounds={loadRounds} />
      ) : tab === 'schedule' ? (
        <Schedule centers={centers} rounds={rounds} assignments={assignments} reload={refresh} />
      ) : tab === 'centers' ? (
        <CentersTable reload={refresh} />
      ) : (
        <Availability centers={centers} rounds={rounds} reloadRounds={loadRounds} />
      )}
    </div>
  );
}
