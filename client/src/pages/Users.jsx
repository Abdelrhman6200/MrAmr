import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag, Modal, UserSelect } from '../components/ui.jsx';
import { DICTS } from '../i18n.js';
import { download, readSpreadsheet, toCsv } from '../sheet.js';

const COLUMN_GUESSES = {
  name: [/^name$/i, /full.?name/i, /الاسم/, /اسم/, /name/i],
  email: [/e-?mail/i, /بريد/, /ايميل|إيميل/],
  role: [/role/i, /position/i, /الدور/, /الوظيفة/],
  manager: [/manager/i, /reports.?to/i, /المدير/],
  title: [/title/i, /job/i, /المسمى/],
  password: [/password/i, /كلمة/],
};

function guess(columns) {
  const taken = new Set();
  const out = {};
  for (const [field, patterns] of Object.entries(COLUMN_GUESSES)) {
    out[field] = '';
    for (const re of patterns) {
      const c = columns.find((col) => re.test(col) && !taken.has(col));
      if (c) {
        out[field] = c;
        taken.add(c);
        break;
      }
    }
  }
  return out;
}

// Accepts a role key, or its English or Arabic label, in any letter case.
function roleResolver(meta) {
  const index = new Map();
  for (const [key, r] of Object.entries(meta.roles)) {
    for (const v of [key, r.label, DICTS.ar[`role.${key}`]]) if (v) index.set(v.trim().toLowerCase(), key);
  }
  return (value) => (value ? index.get(String(value).trim().toLowerCase()) ?? null : undefined);
}

function ImportModal({ people, onClose, onDone }) {
  const { meta, t, roleLabel, user: me, notify } = useApp();
  const [sheet, setSheet] = useState(null);
  const [map, setMap] = useState({});
  const [defaultRole, setDefaultRole] = useState('instructor');
  const [defaultManager, setDefaultManager] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const resolveRole = roleResolver(meta);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const parsed = await readSpreadsheet(file);
      if (!parsed.rows.length) throw new Error(t('upload.empty'));
      setSheet(parsed);
      setMap(guess(parsed.columns));
    } catch (err) {
      setError(err.message && !/zip|xml|invalid|corrupt/i.test(err.message) ? err.message : t('upload.badFile'));
    }
  };

  const rows = (sheet?.rows || []).map((r) => {
    const rawRole = map.role ? r[map.role] : '';
    return {
      name: map.name ? r[map.name] : '',
      email: map.email ? r[map.email] : '',
      role: resolveRole(rawRole),
      rawRole,
      manager_email: map.manager ? r[map.manager] : '',
      title: map.title ? r[map.title] : '',
      password: map.password ? r[map.password] : '',
    };
  });
  const unknownRoles = [...new Set(rows.filter((r) => r.role === null).map((r) => r.rawRole))];

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/users/import', {
        default_role: defaultRole || undefined,
        default_manager_id: defaultManager,
        rows: rows.map(({ rawRole, ...r }) => ({ ...r, role: r.role || undefined, password: r.password || undefined })),
      });
      setResult(res);
      notify(t('import.done', res), res.errors ? 'error' : 'success');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const generated = result?.results.filter((r) => r.password) || [];
  const downloadCreds = () =>
    download(
      'taskflow-sign-in-details.csv',
      toCsv(
        [t('import.name'), t('import.email'), t('import.passwordCol')],
        generated.map((r) => [r.name, r.email, r.password]),
      ),
    );

  const columnSelect = (field) => (
    <select value={map[field] || ''} onChange={(e) => setMap({ ...map, [field]: e.target.value })}>
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
      title={t('import.heading')}
      onClose={onClose}
      wide
      footer={
        result ? (
          <>
            {generated.length > 0 && (
              <button className="btn" onClick={downloadCreds}>
                {t('import.downloadCreds')}
              </button>
            )}
            <button className="btn primary" onClick={onClose}>
              {t('import.finish')}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!sheet || busy || !map.name || !map.email || unknownRoles.length > 0} onClick={submit}>
              {busy ? t('import.importing') : t('import.submit', { n: rows.length })}
            </button>
          </>
        )
      }
    >
      <div className="form">
        {error && <div className="alert error">{error}</div>}
        {result ? (
          <>
            <div className={`alert ${result.errors ? 'warning' : 'info'}`}>{t('import.done', result)}</div>
            {generated.length > 0 && <div className="alert warning">{t('import.credsWarning')}</div>}
            <div className="table-wrap preview tall">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('import.name')}</th>
                    <th>{t('import.email')}</th>
                    <th>{t('users.status')}</th>
                    <th>{t('import.passwordCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.name}</td>
                      <td dir="ltr" className="phone-cell">
                        {r.email}
                      </td>
                      <td>
                        <span className={`pill ${r.status === 'created' ? 'status-done' : r.status === 'skipped' ? 'status-todo' : 'status-blocked'}`}>{t(`import.status.${r.status}`)}</span>
                        {r.message && <div className="muted sm">{r.message}</div>}
                      </td>
                      <td dir="ltr" className="phone-cell">
                        <code>{r.password}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <label>
              {t('upload.file')}
              <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} />
              <span className="hint">{t('import.fileHint')}</span>
            </label>
            {sheet && (
              <>
                <div className="alert info">{t('import.rows', { n: rows.length })}</div>
                <div>
                  <div className="field-label">{t('import.mapping')}</div>
                  <div className="grid-3">
                    {['name', 'email', 'role', 'manager', 'title', 'password'].map((f) => (
                      <label key={f}>
                        {t(`import.${f}`)}
                        {columnSelect(f)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid-2">
                  <label>
                    {t('import.defaultRole')}
                    <select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
                      {Object.keys(meta.roles)
                        .filter((k) => k !== 'ceo' || me.role === 'ceo')
                        .map((k) => (
                          <option key={k} value={k}>
                            {roleLabel(k)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t('import.defaultManager')}
                    <UserSelect users={people.filter((p) => p.active)} value={defaultManager} onChange={setDefaultManager} placeholder={t('users.noManager')} />
                  </label>
                </div>
                {unknownRoles.length > 0 && (
                  <div className="alert error">{unknownRoles.map((v) => t('import.unknownRole', { value: v })).join(' · ')}</div>
                )}
                <div className="table-wrap preview">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('import.name')}</th>
                        <th>{t('import.email')}</th>
                        <th>{t('import.role')}</th>
                        <th>{t('import.manager')}</th>
                        <th>{t('import.title')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          <td>{r.name}</td>
                          <td dir="ltr" className="phone-cell">
                            {r.email}
                          </td>
                          <td className={r.role === null ? 'text-danger' : ''}>{r.role ? roleLabel(r.role) : r.role === null ? r.rawRole : <span className="muted">{roleLabel(defaultRole)}</span>}</td>
                          <td dir="ltr" className="phone-cell">
                            {r.manager_email}
                          </td>
                          <td>{r.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function ResetLink({ user }) {
  const { t } = useApp();
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    setError('');
    try {
      const res = await api.post(`/users/${user.id}/reset-link`);
      setLink({ url: `${window.location.origin}/reset?token=${res.token}`, hours: res.hours });
    } catch (e) {
      setError(e.message);
    }
  };
  const copy = async (e) => {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      // Clipboard API unavailable (e.g. plain http): copy from the selected field instead.
      const input = e.currentTarget.parentElement.querySelector('input');
      input.select();
      if (!document.execCommand('copy')) return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="reset-link">
      {error && <div className="alert error">{error}</div>}
      {!link ? (
        <button type="button" className="btn" onClick={create}>
          🔑 {t('users.resetLink')}
        </button>
      ) : (
        <>
          <div className="row gap">
            <input readOnly dir="ltr" value={link.url} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={copy}>
              {copied ? t('users.copied') : t('users.copy')}
            </button>
          </div>
          <div className="hint">{t('users.resetLinkHint', { hours: link.hours })}</div>
        </>
      )}
    </div>
  );
}

function UserForm({ editing, people, onClose, onSaved }) {
  const { meta, user: me, t, roleLabel, deptLabel } = useApp();
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    name: editing?.name || '',
    email: editing?.email || '',
    title: editing?.title || '',
    role: editing?.role || 'instructor',
    manager_id: editing?.manager_id ?? null,
    password: '',
    active: editing ? editing.active : true,
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = { ...form };
    if (editing && !body.password) delete body.password;
    try {
      const saved = editing ? await api.patch(`/users/${editing.id}`, body) : await api.post('/users', body);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    }
  };

  const roles = Object.entries(meta.roles).filter(([k]) => k !== 'ceo' || me.role === 'ceo');

  return (
    <Modal
      title={editing ? t('users.editTitle', { name: editing.name }) : t('users.addTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="user-form">
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="user-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('users.fullName')}
          <input required value={form.name} onChange={set('name')} />
        </label>
        <label>
          {t('users.email')}
          <input type="email" required value={form.email} onChange={set('email')} />
        </label>
        <label>
          {t('users.role')}
          <select value={form.role} onChange={set('role')}>
            {roles.map(([k, r]) => (
              <option key={k} value={k}>
                {roleLabel(k)} ({deptLabel(r.department)})
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('users.jobTitle')} <span className="hint">{t('users.jobTitleHint')}</span>
          <input value={form.title} onChange={set('title')} placeholder={roleLabel(form.role)} />
        </label>
        <label>
          {t('users.reportsTo')}
          <UserSelect users={people.filter((p) => p.id !== editing?.id && p.active)} value={form.manager_id} onChange={set('manager_id')} placeholder={t('users.noManager')} />
        </label>
        <label>
          {editing ? t('users.resetPassword') : t('users.password')} <span className="hint">{t('users.passwordHint')}</span>
          <input type="password" required={!editing} minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        {editing && editing.id !== me.id && (
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={set('active')} /> {t('users.activeLabel')}
          </label>
        )}
        {editing && editing.id !== me.id && editing.active && <ResetLink user={editing} />}
      </form>
    </Modal>
  );
}

export default function Users() {
  const { isUserAdmin, refresh, version, roleLabel, deptOf, userById, notify, user: me, t, meta } = useApp();
  const [people, setPeople] = useState([]);
  const [sample, setSample] = useState(!!meta.sampleData);
  const [sampleBusy, setSampleBusy] = useState(false);

  // Sample team, projects, tasks, calls and centers to try the app with; removable in one click.
  const toggleSample = async () => {
    if (sample && !confirm(t('sample.confirmRemove'))) return;
    setSampleBusy(true);
    try {
      if (sample) await api.del('/admin/sample');
      else await api.post('/admin/sample');
      notify(t(sample ? 'sample.removed' : 'sample.loaded'), 'success');
      setSample(!sample);
      refresh();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSampleBusy(false);
    }
  };
  const [editing, setEditing] = useState(undefined);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (isUserAdmin) api.get('/users', { all: '1' }).then(setPeople);
  }, [version, isUserAdmin]);

  if (!isUserAdmin) return <Navigate to="/" replace />;
  const shown = people.filter((p) => `${p.name} ${p.email} ${roleLabel(p.role)}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('users.title')}</h1>
        <div className="row gap wrap">
          <button
            className="btn"
            onClick={() =>
              api
                .download('/admin/backup', 'taskflow-backup.json')
                .then(() => notify(t('users.backupDone'), 'success'))
                .catch((e) => notify(e.message, 'error'))
            }
          >
            {t('users.backup')}
          </button>
          {me.role === 'ceo' && (
            <button className={sample ? 'btn danger' : 'btn'} disabled={sampleBusy} onClick={toggleSample}>
              {sampleBusy ? '…' : t(sample ? 'sample.remove' : 'sample.load')}
            </button>
          )}
          <button className="btn" onClick={() => setImporting(true)}>
            {t('users.import')}
          </button>
          <button className="btn primary" onClick={() => setEditing(null)}>
            {t('users.add')}
          </button>
        </div>
      </div>
      <div className="filters">
        <input className="search" placeholder={t('users.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('users.name')}</th>
              <th>{t('users.role')}</th>
              <th>{t('users.department')}</th>
              <th>{t('users.reportsTo')}</th>
              <th>{t('users.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'inactive'}>
                <td>
                  <div className="row gap-sm">
                    <Avatar name={p.name} color={p.avatar_color} size={28} />
                    <div>
                      <div>{p.name}</div>
                      <div className="muted sm">{p.email}</div>
                    </div>
                  </div>
                </td>
                <td>{p.title || roleLabel(p.role)}</td>
                <td>
                  <DeptTag department={deptOf(p.role)} />
                </td>
                <td>{p.manager_id ? userById(p.manager_id)?.name || people.find((x) => x.id === p.manager_id)?.name : <span className="muted">—</span>}</td>
                <td>{p.active ? <span className="pill status-done">{t('users.active')}</span> : <span className="pill status-todo">{t('users.inactive')}</span>}</td>
                <td>
                  {(p.role !== 'ceo' || me.role === 'ceo') && (
                    <button className="link" onClick={() => setEditing(p)}>
                      {t('common.edit')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {importing && <ImportModal people={people} onClose={() => setImporting(false)} onDone={refresh} />}
      {editing !== undefined && (
        <UserForm
          editing={editing}
          people={people}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
            notify(t('users.saved'), 'success');
          }}
        />
      )}
    </div>
  );
}
