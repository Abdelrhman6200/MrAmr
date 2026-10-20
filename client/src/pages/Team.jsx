import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag } from '../components/ui.jsx';

function Node({ user, childrenOf, depth = 0 }) {
  const { roleLabel, deptOf, user: me } = useApp();
  const kids = childrenOf.get(user.id) || [];
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <div className={`org-node ${user.id === me.id ? 'me' : ''}`}>
        {kids.length > 0 ? (
          <button className="icon-btn sm" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="spacer" />
        )}
        <Avatar name={user.name} color={user.avatar_color} size={34} />
        <div className="grow">
          <div className="org-name">
            {user.name} {user.id === me.id && <span className="muted sm">(you)</span>}
          </div>
          <div className="muted sm">{user.title || roleLabel(user.role)}</div>
        </div>
        <DeptTag department={deptOf(user.role)} />
        {kids.length > 0 && <span className="muted sm">{kids.length} report{kids.length > 1 ? 's' : ''}</span>}
        <Link className="link sm" to={`/tasks?assignee_id=${user.id}`}>
          Tasks →
        </Link>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Node key={k.id} user={k} childrenOf={childrenOf} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Team() {
  const { users, meta, deptOf } = useApp();
  const [mode, setMode] = useState('chart');
  const ids = new Set(users.map((u) => u.id));
  const childrenOf = new Map();
  const roots = [];
  for (const u of users) {
    if (u.manager_id && ids.has(u.manager_id)) {
      if (!childrenOf.has(u.manager_id)) childrenOf.set(u.manager_id, []);
      childrenOf.get(u.manager_id).push(u);
    } else roots.push(u);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">{users.length} people across {Object.keys(meta.departments).length} departments</p>
        </div>
        <div className="seg">
          <button className={mode === 'chart' ? 'active' : ''} onClick={() => setMode('chart')}>
            Org chart
          </button>
          <button className={mode === 'dept' ? 'active' : ''} onClick={() => setMode('dept')}>
            By department
          </button>
        </div>
      </div>
      {mode === 'chart' ? (
        <ul className="org panel">
          {roots.map((r) => (
            <Node key={r.id} user={r} childrenOf={childrenOf} />
          ))}
        </ul>
      ) : (
        <div className="dept-grid">
          {Object.entries(meta.departments).map(([key, d]) => {
            const people = users.filter((u) => deptOf(u.role) === key);
            if (!people.length) return null;
            return (
              <section key={key} className="panel" style={{ borderTop: `4px solid ${d.color}` }}>
                <h2>{d.label}</h2>
                {people.map((u) => (
                  <Link key={u.id} to={`/tasks?assignee_id=${u.id}`} className="person-row">
                    <Avatar name={u.name} color={u.avatar_color} size={28} />
                    <div>
                      <div>{u.name}</div>
                      <div className="muted sm">{u.title || meta.roles[u.role]?.label}</div>
                    </div>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
