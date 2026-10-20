import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, timeAgo, useTaskDialog } from './ui.jsx';
import TaskDetail from './TaskDetail.jsx';
import TaskForm from './TaskForm.jsx';

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: '◧', end: true },
  { to: '/tasks', key: 'nav.tasks', icon: '☑' },
  { to: '/projects', key: 'nav.projects', icon: '▤' },
  { to: '/calendar', key: 'nav.calendar', icon: '▦' },
  { to: '/centers', key: 'nav.centers', icon: '⌂' },
  { to: '/calls', key: 'nav.calls', icon: '☎', calls: true },
  { to: '/team', key: 'nav.team', icon: '☷' },
  { to: '/reports', key: 'nav.reports', icon: '▥' },
];

export function LanguageSwitch({ className = '' }) {
  const { lang, setLang, t } = useApp();
  return (
    <div className={`seg lang-switch ${className}`} role="group" aria-label={t('common.language')}>
      <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} lang="en">
        English
      </button>
      <button type="button" className={lang === 'ar' ? 'active' : ''} onClick={() => setLang('ar')} lang="ar">
        العربية
      </button>
    </div>
  );
}

function Notifications() {
  const { version, t } = useApp();
  const { open: openTask } = useTaskDialog();
  const navigate = useNavigate();
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => api.get('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [version]);

  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const click = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`);
    setOpen(false);
    if (n.link) navigate(n.link);
    else if (n.task_id) openTask(n.task_id);
    load();
  };

  // Rebuild the message in the current language when we have its parts.
  const text = (n) => (n.params ? t(`notif.${n.type}`, { ...n.params, day: n.params.day && t(`day.${n.params.day}`) }) : n.message);

  return (
    <div className="notif" ref={ref}>
      <button className="icon-btn bell" onClick={() => setOpen((o) => !o)} aria-label={t('notif.title')}>
        🔔{data.unread > 0 && <span className="badge">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>{t('notif.title')}</strong>
            {data.unread > 0 && (
              <button className="link" onClick={() => api.post('/notifications/read-all').then(load)}>
                {t('notif.markAll')}
              </button>
            )}
          </div>
          {data.items.length === 0 && <div className="muted pad">{t('notif.empty')}</div>}
          {data.items.map((n) => (
            <button key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => click(n)}>
              <span>{text(n)}</span>
              <small className="muted">{timeAgo(n.created_at)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, roleLabel, isUserAdmin, canUseCalls, toast, t } = useApp();
  const { current, create } = useTaskDialog();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);

  return (
    <div className={`shell ${menu ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">✓</span> TaskFlow
        </div>
        <button className="btn primary block" onClick={() => create()}>
          {t('nav.newTask')}
        </button>
        <nav>
          {NAV.filter((n) => !n.calls || canUseCalls).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <span className="nav-icon">{n.icon}</span>
              {t(n.key)}
            </NavLink>
          ))}
          {isUserAdmin && (
            <NavLink to="/users" className="nav-link">
              <span className="nav-icon">⚙</span>
              {t('nav.users')}
            </NavLink>
          )}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className="me">
            <Avatar name={user.name} color={user.avatar_color} size={32} />
            <div>
              <div className="me-name">{user.name}</div>
              <div className="me-role">{user.title || roleLabel(user.role)}</div>
            </div>
          </NavLink>
          <button className="link" onClick={logout}>
            {t('nav.signOut')}
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenu(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setMenu(true)} aria-label={t('nav.menu')}>
            ☰
          </button>
          <div className="grow" />
          <LanguageSwitch />
          <Notifications />
        </header>
        <main className="content">{children}</main>
      </div>
      {current === 'new' && <TaskForm />}
      {current && current !== 'new' && <TaskDetail id={Number(current)} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}
