import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { download, guessColumns, readSpreadsheet, toCsv } from '../sheet.js';
import { Avatar, CallStatusPill, Empty, Modal, Progress, formatDate, formatDateTime, timeAgo } from '../components/ui.jsx';

const OUTCOMES = ['reached', 'no_answer', 'callback', 'not_interested', 'wrong_number'];
const MAX_ROWS = 5000;

function useCallManager() {
  const { user, meta } = useApp();
  return user.role === 'ceo' || (meta.roles[user.role]?.department === 'customer_service' && meta.roles[user.role]?.level !== 'member');
}

function useParam(name) {
  const [params, setParams] = useSearchParams();
  const set = (value) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (value == null) n.delete(name);
      else n.set(name, value);
      return n;
    });
  return [params.get(name), set];
}

// Default "call back" time: tomorrow at 10:00, in the datetime-local format.
function defaultCallback() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isDue = (c) => c.status === 'callback' && c.callback_at && new Date(c.callback_at) <= new Date();

// ---------------------------------------------------------------------------
function LogForm({ call, onLogged }) {
  const { t, callStatusLabel, notify } = useApp();
  const [note, setNote] = useState('');
  const [askCallback, setAskCallback] = useState(false);
  const [callbackAt, setCallbackAt] = useState(defaultCallback);
  const [busy, setBusy] = useState(false);

  const send = async (status) => {
    setBusy(true);
    try {
      await api.patch(`/calls/${call.id}`, { status, note, callback_at: status === 'callback' ? callbackAt : undefined });
      notify(t('calls.logged'), 'success');
      setNote('');
      setAskCallback(false);
      onLogged();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="log-form" onClick={(e) => e.stopPropagation()}>
      <textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('calls.notePh')} />
      <div className="outcomes">
        {OUTCOMES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            className={`btn sm outcome call-${s} ${askCallback && s === 'callback' ? 'active' : ''}`}
            onClick={() => (s === 'callback' ? setAskCallback(true) : send(s))}
          >
            {callStatusLabel(s)}
          </button>
        ))}
      </div>
      {askCallback && (
        <div className="row gap wrap callback-row">
          <label className="grow">
            <span className="field-label">{t('calls.callbackWhen')}</span>
            <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy || !callbackAt} onClick={() => send('callback')}>
            {t('common.save')}
          </button>
        </div>
      )}
    </div>
  );
}

function ExtraFields({ call, limit }) {
  const skip = new Set([call.name, call.phone, call.email].filter(Boolean));
  const entries = Object.entries(call.data || {}).filter(([, v]) => v !== '' && !skip.has(v));
  const shown = limit ? entries.slice(0, limit) : entries;
  if (!shown.length) return null;
  return (
    <dl className="extra">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CallCard({ call, onOpen, onLogged, showLog }) {
  const { t } = useApp();
  return (
    <div className={`card call-card ${isDue(call) ? 'due' : ''}`} onClick={() => onOpen(call.id)} role="button" tabIndex={0}>
      <div className="row between gap wrap">
        <div>
          <div className="call-name">{call.name}</div>
          <div className="muted sm">{t('calls.from', { list: call.list_name })}</div>
        </div>
        <CallStatusPill status={call.status} />
      </div>
      <div className="row gap wrap">
        {call.phone && (
          <a className="btn call-btn" href={`tel:${call.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()} dir="ltr">
            {t('calls.callNow')} {call.phone}
          </a>
        )}
        {call.status === 'callback' && call.callback_at && (
          <span className={`sm ${isDue(call) ? 'text-danger' : 'muted'}`}>
            ⏰ {t('calls.callbackAt')}: {formatDateTime(call.callback_at)}
          </span>
        )}
        {call.attempts > 0 && (
          <span className="muted sm">
            {t('calls.attempts')}: {call.attempts}
          </span>
        )}
      </div>
      <ExtraFields call={call} limit={4} />
      {call.notes && <div className="call-note">📝 {call.notes}</div>}
      {showLog && <LogForm call={call} onLogged={onLogged} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function MyQueue({ onOpen }) {
  const { t, version, refresh, callStatusLabel } = useApp();
  const [mode, setMode] = useState('open');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/calls/mine', { status: mode === 'done' ? 'done' : '' }).then(setData);
  }, [mode, version]);

  if (!data) return <div className="muted">{t('common.loading')}</div>;
  const c = data.counts;
  const open = (c.pending || 0) + (c.no_answer || 0) + (c.callback || 0);
  const due = mode === 'open' ? data.calls.filter(isDue).length : 0;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{open}</div>
          <div className="stat-label">{t('calls.queueOpen')}</div>
        </div>
        <div className={`stat ${due ? 'danger' : ''}`}>
          <div className="stat-value">{due}</div>
          <div className="stat-label">{t('calls.callbacksDue')}</div>
        </div>
        <div className="stat info">
          <div className="stat-value">{data.loggedToday}</div>
          <div className="stat-label">{t('calls.loggedToday')}</div>
        </div>
        <div className="stat success">
          <div className="stat-value">{c.reached || 0}</div>
          <div className="stat-label">{callStatusLabel('reached')}</div>
        </div>
      </div>
      <div className="seg">
        <button className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')}>
          {t('calls.queueOpen')}
        </button>
        <button className={mode === 'done' ? 'active' : ''} onClick={() => setMode('done')}>
          {t('calls.queueDone')}
        </button>
      </div>
      {data.calls.length === 0 ? (
        <Empty icon="☎">{t('calls.queueEmpty')}</Empty>
      ) : (
        <div className="call-grid">
          {data.calls.map((call) => (
            <CallCard key={call.id} call={call} onOpen={onOpen} onLogged={refresh} showLog={mode === 'open'} />
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function UploadModal({ agents, onClose, onDone }) {
  const { t, user, notify } = useApp();
  const manager = useCallManager();
  const [sheet, setSheet] = useState(null);
  const [filename, setFilename] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [map, setMap] = useState({ name: '', phone: '', email: '' });
  const [mode, setMode] = useState(manager ? 'split' : 'mine');
  const [chosen, setChosen] = useState(() => agents.filter((a) => a.role === 'cs_member').map((a) => a.id));
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setReading(true);
    setSheet(null);
    try {
      const parsed = await readSpreadsheet(file);
      if (!parsed.rows.length) throw new Error(t('upload.empty'));
      if (parsed.rows.length > MAX_ROWS) throw new Error(t('upload.tooMany'));
      setSheet(parsed);
      setFilename(file.name);
      setName((n) => n || file.name.replace(/\.[^.]+$/, ''));
      setMap(guessColumns(parsed.columns, parsed.rows));
    } catch (err) {
      setError(err.message && !/zip|xml|invalid|corrupt/i.test(err.message) ? err.message : t('upload.badFile'));
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    if (!map.name && !map.phone) return setError(t('upload.needName'));
    setBusy(true);
    setError('');
    try {
      const agentIds = mode === 'split' ? chosen : mode === 'mine' ? [user.id] : [];
      const res = await api.post('/calls/lists', {
        name,
        description,
        filename,
        columns: sheet.columns,
        agent_ids: agentIds,
        rows: sheet.rows.map((r) => ({ name: map.name ? r[map.name] : '', phone: map.phone ? r[map.phone] : '', email: map.email ? r[map.email] : '', data: r })),
      });
      notify(t('upload.done', { n: res.imported }), 'success');
      onDone(res.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const columnSelect = (field) => (
    <select value={map[field]} onChange={(e) => setMap({ ...map, [field]: e.target.value })}>
      <option value="">{t('upload.notUsed')}</option>
      {sheet.columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );

  return (
    <Modal
      title={t('upload.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!sheet || busy || !name.trim() || (mode === 'split' && !chosen.length)} onClick={submit}>
            {busy ? t('upload.importing') : t('upload.submit', { n: sheet?.rows.length ?? 0 })}
          </button>
        </>
      }
    >
      <div className="form">
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('upload.file')}
          <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} />
          <span className="hint">{t('upload.fileHint')}</span>
        </label>
        {reading && <div className="muted">{t('upload.reading')}</div>}
        {sheet && (
          <>
            <div className="alert info">{t('upload.rows', { n: sheet.rows.length })}</div>
            <div className="grid-3">
              <label className="span-2">
                {t('upload.listName')}
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                {t('upload.description')} <span className="hint">{t('common.optional')}</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
            </div>
            <div>
              <div className="field-label">{t('upload.mapping')}</div>
              <div className="grid-3">
                <label>
                  {t('upload.nameCol')}
                  {columnSelect('name')}
                </label>
                <label>
                  {t('upload.phoneCol')}
                  {columnSelect('phone')}
                </label>
                <label>
                  {t('upload.emailCol')}
                  {columnSelect('email')}
                </label>
              </div>
            </div>
            <div>
              <div className="field-label">{t('upload.preview')}</div>
              <div className="table-wrap preview">
                <table className="table">
                  <thead>
                    <tr>
                      {sheet.columns.map((c) => (
                        <th key={c} className={Object.values(map).includes(c) ? 'mapped' : ''}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {sheet.columns.map((c) => (
                          <td key={c}>{r[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="field-label">{t('upload.assign')}</div>
              <label className="check">
                <input type="radio" checked={mode === 'none'} onChange={() => setMode('none')} /> {t('upload.leave')}
              </label>
              {manager ? (
                <>
                  <label className="check">
                    <input type="radio" checked={mode === 'split'} onChange={() => setMode('split')} /> {t('upload.split')}
                  </label>
                  {mode === 'split' && (
                    <div className="agent-picks">
                      {agents.map((a) => (
                        <label key={a.id} className="check chip-check">
                          <input type="checkbox" checked={chosen.includes(a.id)} onChange={() => toggle(a.id)} />
                          <Avatar name={a.name} color={a.avatar_color} size={20} /> {a.name}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <label className="check">
                  <input type="radio" checked={mode === 'mine'} onChange={() => setMode('mine')} /> {t('upload.mine')}
                </label>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AssignModal({ listId, callIds, agents, onClose, onDone }) {
  const { t, notify } = useApp();
  const [chosen, setChosen] = useState(() => agents.filter((a) => a.role === 'cs_member').map((a) => a.id));
  const [error, setError] = useState('');
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const send = async (agentIds) => {
    setError('');
    try {
      const res = await api.post(`/calls/lists/${listId}/assign`, { agent_ids: agentIds, call_ids: callIds || undefined });
      notify(t('calls.assignDone', { n: res.updated }), 'success');
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal
      title={t('calls.assignTitle')}
      onClose={onClose}
      footer={
        <>
          {callIds && (
            <button className="btn danger" onClick={() => send([])}>
              {t('calls.unassign')}
            </button>
          )}
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!chosen.length} onClick={() => send(chosen)}>
            {t('calls.assignTo')} ({chosen.length})
          </button>
        </>
      }
    >
      <div className="form">
        {error && <div className="alert error">{error}</div>}
        <p className="muted">{t('calls.assignExplain')}</p>
        {callIds && <div className="alert info">{t('calls.selected', { n: callIds.length })}</div>}
        <div className="agent-picks">
          {agents.map((a) => (
            <label key={a.id} className="check chip-check">
              <input type="checkbox" checked={chosen.includes(a.id)} onChange={() => toggle(a.id)} />
              <Avatar name={a.name} color={a.avatar_color} size={20} /> {a.name}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function AgentStats() {
  const { t, version, callStatusLabel } = useApp();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/calls/stats', { days }).then(setData).catch(() => {});
  }, [days, version]);
  if (!data) return null;
  return (
    <section className="panel">
      <div className="row between wrap gap">
        <h2>{t('calls.stats')}</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 7, 30].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? t('calls.statToday') : t('calls.statsDays', { n })}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap flat">
        <table className="table">
          <thead>
            <tr>
              <th>{t('calls.agent')}</th>
              <th>{t('calls.statOpen')}</th>
              <th>{t('calls.callbacksDue')}</th>
              <th>{t('calls.statToday')}</th>
              <th>{t('calls.statLogged')}</th>
              <th>{t('calls.statContacts')}</th>
              <th>{callStatusLabel('reached')}</th>
              <th>{t('calls.statRate')}</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="row gap-sm">
                    <Avatar name={a.name} color={a.avatar_color} size={22} /> {a.name}
                  </span>
                </td>
                <td>{a.open}</td>
                <td className={a.due ? 'text-danger' : ''}>{a.due}</td>
                <td>{a.today}</td>
                <td>{a.logged}</td>
                <td>{a.contacts}</td>
                <td>{a.reached}</td>
                <td>
                  <div className="row gap-sm">
                    <Progress value={a.reached} total={a.contacts} />
                    <span className="sm">{a.contacts ? Math.round((a.reached / a.contacts) * 100) : 0}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Lists({ agents, onOpenList }) {
  const { t, version } = useApp();
  const [data, setData] = useState(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    api.get('/calls/lists').then(setData);
  }, [version]);
  if (!data) return <div className="muted">{t('common.loading')}</div>;

  return (
    <>
      {data.can_assign && <AgentStats />}
      <div className="row between wrap gap">
        <div />
        <button className="btn primary" onClick={() => setUploading(true)}>
          {t('calls.upload')}
        </button>
      </div>
      {data.lists.length === 0 && <Empty icon="⬆">{t('calls.noLists')}</Empty>}
      <div className="project-grid">
        {data.lists.map((l) => (
          <button key={l.id} className="card project-card list-card" style={{ '--c': 'var(--accent)' }} onClick={() => onOpenList(l.id)}>
            <h3>{l.name}</h3>
            {l.description && <p className="muted clamp">{l.description}</p>}
            <Progress value={l.done} total={l.total} />
            <div className="row between sm wrap gap">
              <span>{t('calls.progress', { done: l.done, total: l.total })}</span>
              <span className="text-success">{t('calls.reached', { n: l.reached })}</span>
            </div>
            <div className="row gap wrap sm">
              {l.unassigned > 0 && <span className="pill call-pending">{t('calls.unassignedCount', { n: l.unassigned })}</span>}
              {l.mine > 0 && <span className="pill status-in_progress">{t('calls.mineCount', { n: l.mine })}</span>}
            </div>
            <div className="muted sm">
              {t('calls.uploadedBy', { name: l.created_by_name })} · {timeAgo(l.created_at)}
            </div>
          </button>
        ))}
      </div>
      {uploading && (
        <UploadModal
          agents={agents}
          onClose={() => setUploading(false)}
          onDone={(id) => {
            setUploading(false);
            onOpenList(id);
          }}
        />
      )}
    </>
  );
}

function ListDetail({ id, agents, onOpen, onBack }) {
  const { t, version, refresh, notify, callStatusLabel, meta } = useApp();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', assignee_id: '' });
  const [selected, setSelected] = useState([]);
  const [assigning, setAssigning] = useState(null);

  const load = useCallback(() => {
    api
      .get(`/calls/lists/${id}`, filters)
      .then(setList)
      .catch((e) => setError(e.message));
  }, [id, JSON.stringify(filters)]);

  useEffect(() => {
    const timer = setTimeout(load, 150);
    return () => clearTimeout(timer);
  }, [load, version]);
  useEffect(() => setSelected([]), [id, JSON.stringify(filters)]);

  if (error)
    return (
      <div className="page">
        <div className="alert error">{error}</div>
        <button className="link" onClick={onBack}>
          {t('calls.back')}
        </button>
      </div>
    );
  if (!list) return <div className="muted">{t('common.loading')}</div>;

  const total = Object.values(list.byStatus).reduce((a, b) => a + b, 0);
  const allSelected = list.calls.length > 0 && selected.length === list.calls.length;
  const toggle = (cid) => setSelected((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));

  const exportCsv = async () => {
    const full = await api.get(`/calls/lists/${id}`);
    const extra = [t('calls.agent'), t('calls.outcome'), t('calls.attempts'), t('calls.lastCalled'), t('calls.callbackAt'), t('calls.notes')];
    const base = full.columns.length ? full.columns : ['Name', 'Phone', 'Email'];
    const rows = full.calls.map((c) => [
      ...(full.columns.length ? base.map((col) => c.data[col] ?? '') : [c.name, c.phone, c.email]),
      c.assignee_name || '',
      callStatusLabel(c.status),
      c.attempts,
      c.last_called_at ? formatDateTime(c.last_called_at) : '',
      c.callback_at ? formatDateTime(c.callback_at) : '',
      c.notes || '',
    ]);
    download(`${full.name}.csv`, toCsv([...base, ...extra], rows));
  };

  const remove = async () => {
    if (!confirm(t('calls.confirmDelete', { name: list.name }))) return;
    await api.del(`/calls/lists/${id}`);
    notify(t('calls.listDeleted'));
    refresh();
    onBack();
  };

  return (
    <div className="page">
      <button className="link sm back-link" onClick={onBack}>
        {t('calls.back')}
      </button>
      <div className="page-head">
        <div>
          <h1>{list.name}</h1>
          {list.description && <p className="muted">{list.description}</p>}
          <div className="muted sm">
            {t('calls.uploadedBy', { name: list.created_by_name })} · {formatDate(list.created_at)}
            {list.source_filename && <> · 📄 {list.source_filename}</>}
          </div>
        </div>
        <div className="row gap wrap">
          <button className="btn" onClick={exportCsv}>
            {t('calls.export')}
          </button>
          {list.can_assign && list.calls.some((c) => !c.assignee_id) && (
            <button className="btn primary" onClick={() => setAssigning({ callIds: null })}>
              {t('calls.assignUnassigned')}
            </button>
          )}
          {list.can_manage && (
            <button className="btn danger" onClick={remove}>
              {t('calls.deleteList')}
            </button>
          )}
        </div>
      </div>

      <div className="status-strip">
        {meta.callStatuses.map((s) => (
          <button
            key={s.key}
            className={`status-chip ${filters.status === s.key ? 'active' : ''}`}
            onClick={() => setFilters({ ...filters, status: filters.status === s.key ? '' : s.key })}
          >
            <CallStatusPill status={s.key} />
            <strong>{list.byStatus[s.key] || 0}</strong>
          </button>
        ))}
        <div className="grow strip-progress">
          <Progress value={total - (list.byStatus.pending || 0) - (list.byStatus.no_answer || 0) - (list.byStatus.callback || 0)} total={total} />
        </div>
      </div>

      {list.byAgent.length > 0 && (
        <section className="panel">
          <h2>{t('calls.byAgent')}</h2>
          <div className="table-wrap flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('calls.agent')}</th>
                  <th>{t('calls.total')}</th>
                  <th>{t('calls.done')}</th>
                  <th>{callStatusLabel('reached')}</th>
                  <th>{t('calls.callbacks')}</th>
                  <th style={{ width: '30%' }} />
                </tr>
              </thead>
              <tbody>
                {list.byAgent.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => setFilters({ ...filters, assignee_id: String(a.id) })}>
                    <td>
                      <span className="row gap-sm">
                        <Avatar name={a.name} color={a.avatar_color} size={22} /> {a.name}
                      </span>
                    </td>
                    <td>{a.total}</td>
                    <td>{a.done}</td>
                    <td>{a.reached}</td>
                    <td>{a.callback}</td>
                    <td>
                      <Progress value={a.done} total={a.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="filters">
        <input className="search" placeholder={t('calls.searchPh')} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">{t('calls.allStatuses')}</option>
          <option value="open">{t('calls.openOnly')}</option>
          {meta.callStatuses.map((s) => (
            <option key={s.key} value={s.key}>
              {callStatusLabel(s.key)}
            </option>
          ))}
        </select>
        <select value={filters.assignee_id} onChange={(e) => setFilters({ ...filters, assignee_id: e.target.value })}>
          <option value="">{t('calls.allAgents')}</option>
          <option value="none">{t('common.unassigned')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {Object.values(filters).some(Boolean) && (
          <button className="link" onClick={() => setFilters({ q: '', status: '', assignee_id: '' })}>
            {t('common.clear')}
          </button>
        )}
      </div>

      {list.can_assign && selected.length > 0 && (
        <div className="bulk-bar">
          <span>{t('calls.selected', { n: selected.length })}</span>
          <button className="btn primary sm" onClick={() => setAssigning({ callIds: selected })}>
            {t('calls.assignSelected')}
          </button>
        </div>
      )}

      {list.calls.length === 0 ? (
        <Empty>{t('calls.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {list.can_assign && (
                  <th className="check-col">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : list.calls.map((c) => c.id))} />
                  </th>
                )}
                <th>{t('calls.contact')}</th>
                <th>{t('calls.phone')}</th>
                <th>{t('calls.agent')}</th>
                <th>{t('calls.outcome')}</th>
                <th>{t('calls.attempts')}</th>
                <th>{t('calls.lastCalled')}</th>
                <th>{t('calls.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {list.calls.map((c) => (
                <tr key={c.id} className={`clickable ${selected.includes(c.id) ? 'selected' : ''}`} onClick={() => onOpen(c.id)}>
                  {list.can_assign && (
                    <td className="check-col" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                    </td>
                  )}
                  <td className="cell-title">{c.name}</td>
                  <td dir="ltr" className="phone-cell">
                    {c.phone}
                  </td>
                  <td>
                    {c.assignee_name ? (
                      <span className="row gap-sm">
                        <Avatar name={c.assignee_name} color={c.assignee_color} size={20} /> {c.assignee_name}
                      </span>
                    ) : (
                      <span className="muted">{t('common.unassigned')}</span>
                    )}
                  </td>
                  <td>
                    <CallStatusPill status={c.status} />
                    {c.status === 'callback' && c.callback_at && <div className={`sm ${isDue(c) ? 'text-danger' : 'muted'}`}>⏰ {formatDateTime(c.callback_at)}</div>}
                  </td>
                  <td>{c.attempts}</td>
                  <td className="muted sm">{c.last_called_at ? timeAgo(c.last_called_at) : '—'}</td>
                  <td className="notes-cell">{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <AssignModal
          listId={id}
          callIds={assigning.callIds}
          agents={agents}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            setSelected([]);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function CallDialog({ id, agents, onClose }) {
  const { t, version, refresh, notify, user, callStatusLabel } = useApp();
  const manager = useCallManager();
  const [call, setCall] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/calls/${id}`)
      .then(setCall)
      .catch((e) => setError(e.message));
  }, [id, version]);

  const reassign = async (assigneeId) => {
    try {
      await api.patch(`/calls/${id}`, { assignee_id: assigneeId });
      if (assigneeId === user.id && !manager) notify(t('calls.claimed'), 'success');
      refresh();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <Modal title={call ? call.name : t('nav.calls')} onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {call && (
        <div className="task-detail">
          <div className="task-main">
            <div className="row gap wrap">
              <CallStatusPill status={call.status} />
              <span className="muted sm">{t('calls.from', { list: call.list_name })}</span>
            </div>
            <div className="row gap wrap">
              {call.phone && (
                <a className="btn call-btn" href={`tel:${call.phone.replace(/[^\d+]/g, '')}`} dir="ltr">
                  {t('calls.callNow')} {call.phone}
                </a>
              )}
              {call.email && (
                <a className="btn" href={`mailto:${call.email}`} dir="ltr">
                  ✉ {call.email}
                </a>
              )}
            </div>
            {call.can_log && (
              <section>
                <h4>{t('calls.log')}</h4>
                <LogForm call={call} onLogged={refresh} />
              </section>
            )}
            {call.notes && (
              <section>
                <h4>{t('calls.notes')}</h4>
                <div className="comment-body">{call.notes}</div>
              </section>
            )}
            <section>
              <h4>{t('calls.history')}</h4>
              {call.logs.length === 0 ? (
                <div className="muted">{t('calls.noHistory')}</div>
              ) : (
                <ul className="activity">
                  {call.logs.map((l) => (
                    <li key={l.id}>
                      <strong>{l.user_name}</strong> · {callStatusLabel(l.status)} {l.note && <em>— {l.note}</em>} <small className="muted">{timeAgo(l.created_at)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <aside className="task-side">
            <div className="field">
              <span className="field-label">{t('calls.agent')}</span>
              {manager ? (
                <select value={call.assignee_id ?? ''} onChange={(e) => reassign(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t('common.unassigned')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div>{call.assignee_name || <span className="muted">{t('common.unassigned')}</span>}</div>
              )}
              {!manager && !call.assignee_id && (
                <button className="btn primary block" onClick={() => reassign(user.id)}>
                  {t('calls.claim')}
                </button>
              )}
            </div>
            <div className="field">
              <span className="field-label">{t('calls.attempts')}</span>
              <div>{call.attempts}</div>
            </div>
            <div className="field">
              <span className="field-label">{t('calls.lastCalled')}</span>
              <div>{call.last_called_at ? timeAgo(call.last_called_at) : '—'}</div>
            </div>
            {call.callback_at && call.status === 'callback' && (
              <div className="field">
                <span className="field-label">{t('calls.callbackAt')}</span>
                <div className={isDue(call) ? 'text-danger' : ''}>{formatDateTime(call.callback_at)}</div>
              </div>
            )}
            <div className="field">
              <span className="field-label">{t('calls.details')}</span>
              <ExtraFields call={{ ...call, name: null, phone: null, email: null }} />
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export default function Calls() {
  const { t, canUseCalls, user } = useApp();
  const [listId, setListId] = useParam('list');
  const [callId, setCallId] = useParam('call');
  const [tab, setTab] = useParam('tab');
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    if (canUseCalls) api.get('/calls/agents').then(setAgents).catch(() => {});
  }, [canUseCalls]);

  if (!canUseCalls) return <Navigate to="/" replace />;
  const current = tab || (user.role === 'ceo' || user.role === 'cs_head' ? 'lists' : 'queue');

  return (
    <>
      {listId ? (
        <ListDetail id={Number(listId)} agents={agents} onOpen={setCallId} onBack={() => setListId(null)} />
      ) : (
        <div className="page">
          <div className="page-head">
            <div>
              <h1>{t('calls.title')}</h1>
              <p className="muted">{t('calls.subtitle')}</p>
            </div>
            <div className="seg">
              <button className={current === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
                {t('calls.myQueue')}
              </button>
              <button className={current === 'lists' ? 'active' : ''} onClick={() => setTab('lists')}>
                {t('calls.lists')}
              </button>
            </div>
          </div>
          {current === 'queue' ? <MyQueue onOpen={setCallId} /> : <Lists agents={agents} onOpenList={setListId} />}
        </div>
      )}
      {callId && <CallDialog id={Number(callId)} agents={agents} onClose={() => setCallId(null)} />}
    </>
  );
}
