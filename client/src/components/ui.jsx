import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context.jsx';
import { getActiveLocale } from '../i18n.js';
import { parseServerTime } from '../time.js';
import Icon from './Icon.jsx';

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

export function Avatar({ name, color, size = 28, title }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: color || '#94a3b8', fontSize: size * 0.4 }} title={title ?? name}>
      {name ? initials(name) : '?'}
    </span>
  );
}

export function StatusPill({ status }) {
  const { statusLabel } = useApp();
  return <span className={`pill status-${status}`}>{statusLabel(status)}</span>;
}

export function PriorityTag({ priority }) {
  const { priorityLabel } = useApp();
  return <span className={`priority priority-${priority}`}>{priorityLabel(priority)}</span>;
}

export function TypeTag({ type }) {
  const { typeLabel } = useApp();
  return <span className="tag">{typeLabel(type)}</span>;
}

export function TrackTag({ track }) {
  const { trackLabel } = useApp();
  return track ? <span className="tag track">{trackLabel(track)}</span> : null;
}

// The task types someone picks from when creating or editing work: the Academic
// Material team gets its own work (and General); other teams don't see it.
// Leadership sees everything.
export function typesFor(meta, user) {
  const dept = meta.roles[user.role]?.department;
  if (dept === 'executive' || dept === 'operations') return meta.taskTypes;
  if (dept === 'academic') return meta.taskTypes.filter((x) => x.group === 'academic' || x.key === 'general');
  return meta.taskTypes.filter((x) => x.group !== 'academic');
}

// <option>s for a task type <select>, grouped by department. `all` lists every
// type (filters); otherwise the user's own, plus `current` if it is another.
export function TypeOptions({ all = false, current }) {
  const { meta, user, t, typeLabel } = useApp();
  const list = all ? meta.taskTypes : typesFor(meta, user);
  const shown = current && !list.some((x) => x.key === current) ? [...list, meta.taskTypes.find((x) => x.key === current)].filter(Boolean) : list;
  const groups = new Map();
  for (const x of shown) {
    const group = x.group || 'general';
    groups.set(group, [...(groups.get(group) || []), x]);
  }
  return [...groups].map(([group, types]) => (
    <optgroup key={group} label={t(`typeGroup.${group}`)}>
      {types.map((x) => (
        <option key={x.key} value={x.key}>
          {typeLabel(x.key)}
        </option>
      ))}
    </optgroup>
  ));
}

// <option>s for a track <select>, after an empty "none" option.
export function TrackOptions({ none }) {
  const { meta, trackLabel } = useApp();
  return (
    <>
      <option value="">{none}</option>
      {meta.tracks.map((x) => (
        <option key={x.key} value={x.key}>
          {trackLabel(x.key)}
        </option>
      ))}
    </>
  );
}

export function CallStatusPill({ status }) {
  const { callStatusLabel } = useApp();
  return <span className={`pill call-${status}`}>{callStatusLabel(status)}</span>;
}

export function DeptTag({ department }) {
  const { deptLabel, deptColor } = useApp();
  if (!department) return null;
  return (
    <span className="dept" style={{ '--c': deptColor(department) }}>
      {deptLabel(department)}
    </span>
  );
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function isOverdue(task) {
  return task.status !== 'done' && task.due_date && task.due_date < todayISO();
}

export function formatDate(value) {
  const d = parseServerTime(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getActiveLocale(), { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function formatDateTime(value) {
  const d = parseServerTime(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(getActiveLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function DueDate({ task }) {
  const { t } = useApp();
  if (!task.due_date) return <span className="muted">—</span>;
  const overdue = isOverdue(task);
  const today = task.due_date === todayISO();
  return <span className={`due ${overdue ? 'overdue' : ''} ${today && task.status !== 'done' ? 'today' : ''}`}>{today ? t('tasks.today') : formatDate(task.due_date)}</span>;
}

export function timeAgo(ts) {
  const date = parseServerTime(ts);
  if (!date) return '';
  const s = Math.round((Date.now() - date) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getActiveLocale(), { numeric: 'auto', style: 'short' });
  if (s < 60) return rtf.format(0, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 86400 * 7) return rtf.format(-Math.floor(s / 86400), 'day');
  return date.toLocaleDateString(getActiveLocale());
}

export function Modal({ title, onClose, children, wide, footer }) {
  const { t } = useApp();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// `icon`: an Icon name (or any node).
export function Empty({ children, icon = 'done' }) {
  return (
    <div className="empty">
      <div className="empty-icon">{typeof icon === 'string' && icon.length > 2 ? <Icon name={icon} size={22} /> : icon}</div>
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}

export function Progress({ value, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress" title={`${value}/${total} (${pct}%)`}>
      <div className="progress-bar" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// Opens task detail / new-task dialogs via the URL so links are shareable.
export function useTaskDialog() {
  const [params, setParams] = useSearchParams();
  const open = (id) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const k of [...n.keys()]) if (k.startsWith('new_')) n.delete(k);
      n.set('task', id);
      return n;
    });
  const create = (defaults = {}) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('task', 'new');
      for (const [k, v] of Object.entries(defaults)) if (v != null) n.set(`new_${k}`, v);
      return n;
    });
  const close = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const k of [...n.keys()]) if (k === 'task' || k.startsWith('new_')) n.delete(k);
      return n;
    });
  return { current: params.get('task'), params, open, create, close };
}

export function UserSelect({ users, value, onChange, placeholder, allowEmpty = true, ...rest }) {
  const { roleLabel, t } = useApp();
  placeholder ??= t('common.unassigned');
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} {...rest}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} — {u.title || roleLabel(u.role)}
        </option>
      ))}
    </select>
  );
}
