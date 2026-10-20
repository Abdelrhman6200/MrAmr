import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context.jsx';

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
  const { meta } = useApp();
  const label = meta.statuses.find((s) => s.key === status)?.label ?? status;
  return <span className={`pill status-${status}`}>{label}</span>;
}

export function PriorityTag({ priority }) {
  const { meta } = useApp();
  const label = meta.priorities.find((p) => p.key === priority)?.label ?? priority;
  return <span className={`priority priority-${priority}`}>{label}</span>;
}

export function TypeTag({ type }) {
  const { meta } = useApp();
  return <span className="tag">{meta.taskTypes.find((t) => t.key === type)?.label ?? type}</span>;
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

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function DueDate({ task }) {
  if (!task.due_date) return <span className="muted">—</span>;
  const overdue = isOverdue(task);
  const today = task.due_date === todayISO();
  return <span className={`due ${overdue ? 'overdue' : ''} ${today && task.status !== 'done' ? 'today' : ''}`}>{today ? 'Today' : formatDate(task.due_date)}</span>;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const date = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  const s = Math.round((Date.now() - date) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString();
}

export function Modal({ title, onClose, children, wide, footer }) {
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
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ children, icon = '✓' }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div>{children}</div>
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

export function UserSelect({ users, value, onChange, placeholder = 'Unassigned', allowEmpty = true, ...rest }) {
  const { roleLabel } = useApp();
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
