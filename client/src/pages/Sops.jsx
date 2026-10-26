import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Empty, Spinner, timeAgo, typesFor, useSops } from '../components/ui.jsx';
import { canEditSop, sopFor } from '../sops.js';

// How each kind of work is done. New tasks start with these steps as their
// checklist; required steps must be ticked before review. Managers change the
// ones for their own team's work. ?type=… opens on one SOP (links from tasks).
export default function Sops() {
  const { meta, user, t, lang, typeLabel, version } = useApp();
  const [params] = useSearchParams();
  const focus = params.get('type');
  const [custom, setCustom] = useSops();
  const [stats, setStats] = useState({});
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/sops/stats').then(setStats).catch(() => {});
  }, [version]);
  useEffect(() => {
    if (custom && focus) document.getElementById(`sop-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [custom, focus]);

  if (!custom) return <Spinner />;

  const needle = q.trim().toLowerCase();
  const matches = (type) => {
    if (!needle) return true;
    const sop = sopFor(type, lang, custom);
    return [typeLabel(type), sop.when, sop.target, sop.done, ...sop.steps.map((s) => s.text)].some((x) => (x || '').toLowerCase().includes(needle));
  };
  const groups = new Map();
  for (const x of typesFor(meta, user).filter((x) => matches(x.key))) {
    const group = x.group || 'general';
    groups.set(group, [...(groups.get(group) || []), x]);
  }

  return (
    <div className="page sops-page">
      <div className="page-head">
        <div>
          <h1>{t('sop.title')}</h1>
          <p className="muted">{t('sop.intro')}</p>
        </div>
        <div className="row gap no-print">
          <input className="search" placeholder={t('sop.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => window.print()}>
            <Icon name="printer" size={16} /> {t('sop.print')}
          </button>
        </div>
      </div>
      {groups.size === 0 && <Empty icon="search">{t('sop.noMatch')}</Empty>}
      {[...groups].map(([group, types]) => (
        <section key={group} className="sop-group">
          <h2>{t(`typeGroup.${group}`)}</h2>
          <div className="sop-grid">
            {types.map((x) => (
              <SopCard
                key={x.key}
                type={x.key}
                title={typeLabel(x.key)}
                custom={custom}
                stats={stats[x.key]}
                focused={focus === x.key}
                onSaved={setCustom}
                canEdit={canEditSop(meta.roles, user.role, meta.taskTypes, x.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SopCard({ type, title, custom, stats, focused, onSaved, canEdit }) {
  const { t, lang, notify } = useApp();
  const sop = sopFor(type, lang, custom);
  const edited = custom[type];
  const [draft, setDraft] = useState(null);

  const save = async (body) => {
    try {
      onSaved(await api.put(`/sops/${type}`, body));
      setDraft(null);
      notify(t('sop.saved'), 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <article id={`sop-${type}`} className={`panel sop-card ${focused ? 'focused' : ''}`}>
      <div className="sop-head">
        <h3>
          {title}
          {edited && <span className="sop-version">v{edited.version}</span>}
        </h3>
        {canEdit && draft == null && (
          <button className="btn sm no-print" onClick={() => setDraft({ ...sop, steps: sop.steps.map((s) => ({ ...s })) })}>
            {t('common.edit')}
          </button>
        )}
      </div>
      {draft == null ? (
        <>
          {sop.when && <p className="sop-when">{sop.when}</p>}
          {sop.target && (
            <div className="sop-target">
              <Icon name="clock" size={14} /> {sop.target}
            </div>
          )}
          <ol className="sop-steps">
            {sop.steps.map((s, i) => (
              <li key={i}>
                {s.text}
                {s.required && <span className="req-badge">{t('sop.required')}</span>}
              </li>
            ))}
          </ol>
          {sop.done && (
            <div className="sop-done">
              <Icon name="done" size={14} /> <b>{t('sop.done')}:</b> {sop.done}
            </div>
          )}
          {stats && (
            <div className="sop-stats muted sm">
              {t('sop.stats', { used: stats.used, open: stats.open })}
              {stats.late > 0 && <span className="late"> · {t('sop.statsLate', { n: stats.late })}</span>}
              {stats.done_with_date > 0 && <> · {t('sop.statsOnTime', { pct: Math.round((stats.on_time / stats.done_with_date) * 100) })}</>}
            </div>
          )}
          {edited && <div className="muted sm">{t('sop.editedBy', { name: edited.updated_by_name || '—', when: timeAgo(edited.updated_at) })}</div>}
        </>
      ) : (
        <SopEditor draft={draft} setDraft={setDraft} onSave={() => save(draft)} onRestore={edited ? () => save({ steps: [] }) : null} />
      )}
    </article>
  );
}

function SopEditor({ draft, setDraft, onSave, onRestore }) {
  const { t } = useApp();
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const setStep = (i, patch) => setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, by) => {
    const steps = [...draft.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + by, 0, s);
    setDraft({ ...draft, steps });
  };
  const remove = (i) => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) });

  return (
    <div className="sop-editor form">
      <label>
        {t('sop.when')}
        <input value={draft.when} onChange={set('when')} />
      </label>
      <label>
        {t('sop.target')}
        <input value={draft.target} onChange={set('target')} />
      </label>
      <div>
        <div className="label">{t('sop.steps')}</div>
        <ol className="sop-step-editor">
          {draft.steps.map((s, i) => (
            <li key={i}>
              <input value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} aria-label={t('sop.stepN', { n: i + 1 })} />
              <button type="button" className={`req-toggle ${s.required ? 'on' : ''}`} aria-pressed={s.required} onClick={() => setStep(i, { required: !s.required })}>
                {t('sop.required')}
              </button>
              <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('sop.up')}>
                <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button type="button" className="icon-btn sm" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)} aria-label={t('sop.down')}>
                <Icon name="chevron" size={14} />
              </button>
              <button type="button" className="icon-btn sm" onClick={() => remove(i)} aria-label={t('task.removeItem')}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn sm" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { text: '', required: false }] })}>
          <Icon name="plus" size={14} /> {t('sop.addStep')}
        </button>
        <p className="hint">{t('sop.requiredHint')}</p>
      </div>
      <label>
        {t('sop.done')}
        <textarea rows={2} value={draft.done} onChange={set('done')} />
      </label>
      <div className="row gap wrap">
        <button className="btn primary sm" disabled={!draft.steps.some((s) => s.text.trim())} onClick={onSave}>
          {t('common.save')}
        </button>
        <button className="btn sm" onClick={() => setDraft(null)}>
          {t('common.cancel')}
        </button>
        {onRestore && (
          <button className="btn sm" onClick={onRestore}>
            <Icon name="undo" size={14} /> {t('sop.restore')}
          </button>
        )}
      </div>
    </div>
  );
}
