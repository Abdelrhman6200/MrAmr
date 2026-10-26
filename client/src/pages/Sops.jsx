import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Spinner, timeAgo, typesFor, useSops } from '../components/ui.jsx';
import { canEditSop, sopSteps } from '../sops.js';

// The standard steps for each kind of work. New tasks start with them as their
// checklist; managers change the ones for their own team's work.
export default function Sops() {
  const { meta, user, t, typeLabel } = useApp();
  const [custom, setCustom] = useSops();
  if (!custom) return <Spinner />;

  const groups = new Map();
  for (const x of typesFor(meta, user)) {
    const group = x.group || 'general';
    groups.set(group, [...(groups.get(group) || []), x]);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('sop.title')}</h1>
          <p className="muted">{t('sop.intro')}</p>
        </div>
      </div>
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

function SopCard({ type, title, custom, onSaved, canEdit }) {
  const { t, lang, notify } = useApp();
  const steps = sopSteps(type, lang, custom);
  const edited = custom[type];
  const [draft, setDraft] = useState(null);

  const save = async (list) => {
    try {
      onSaved(await api.put(`/sops/${type}`, { steps: list }));
      setDraft(null);
      notify(t('sop.saved'), 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <article className="panel sop-card">
      <div className="sop-head">
        <h3>{title}</h3>
        {canEdit && draft == null && (
          <button className="btn sm" onClick={() => setDraft(steps.join('\n'))}>
            {t('common.edit')}
          </button>
        )}
      </div>
      {draft == null ? (
        <ol className="sop-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : (
        <>
          <textarea rows={Math.max(steps.length + 1, 4)} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="hint">{t('sop.oneStepPerLine')}</p>
          <div className="row gap wrap">
            <button className="btn primary sm" onClick={() => save(draft.split('\n'))}>
              {t('common.save')}
            </button>
            <button className="btn sm" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
            {edited && (
              <button className="btn sm" onClick={() => save([])}>
                <Icon name="undo" size={14} /> {t('sop.restore')}
              </button>
            )}
          </div>
        </>
      )}
      {edited && <div className="muted sm">{t('sop.editedBy', { name: edited.updated_by_name || '—', when: timeAgo(edited.updated_at) })}</div>}
    </article>
  );
}
