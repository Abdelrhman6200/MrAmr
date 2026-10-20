import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag, Modal, UserSelect } from '../components/ui.jsx';

function UserForm({ editing, people, onClose, onSaved }) {
  const { meta, user: me } = useApp();
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
      title={editing ? `Edit ${editing.name}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" form="user-form">
            Save
          </button>
        </>
      }
    >
      <form id="user-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <label>
          Full name
          <input required value={form.name} onChange={set('name')} />
        </label>
        <label>
          Email
          <input type="email" required value={form.email} onChange={set('email')} />
        </label>
        <label>
          Role
          <select value={form.role} onChange={set('role')}>
            {roles.map(([k, r]) => (
              <option key={k} value={k}>
                {r.label} ({meta.departments[r.department].label})
              </option>
            ))}
          </select>
        </label>
        <label>
          Job title <span className="hint">(optional, defaults to role)</span>
          <input value={form.title} onChange={set('title')} placeholder={meta.roles[form.role].label} />
        </label>
        <label>
          Reports to
          <UserSelect users={people.filter((p) => p.id !== editing?.id && p.active)} value={form.manager_id} onChange={set('manager_id')} placeholder="No manager (top level)" />
        </label>
        <label>
          {editing ? 'Reset password' : 'Password'} <span className="hint">(min 8 characters)</span>
          <input type="password" required={!editing} minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        {editing && editing.id !== me.id && (
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={set('active')} /> Active (can sign in)
          </label>
        )}
      </form>
    </Modal>
  );
}

export default function Users() {
  const { isUserAdmin, refresh, version, roleLabel, deptOf, userById, notify, user: me } = useApp();
  const [people, setPeople] = useState([]);
  const [editing, setEditing] = useState(undefined);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (isUserAdmin) api.get('/users', { all: '1' }).then(setPeople);
  }, [version, isUserAdmin]);

  if (!isUserAdmin) return <Navigate to="/" replace />;
  const shown = people.filter((p) => `${p.name} ${p.email} ${roleLabel(p.role)}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Users</h1>
        <button className="btn primary" onClick={() => setEditing(null)}>
          + Add user
        </button>
      </div>
      <div className="filters">
        <input className="search" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              <th>Reports to</th>
              <th>Status</th>
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
                <td>{p.active ? <span className="pill status-done">Active</span> : <span className="pill status-todo">Inactive</span>}</td>
                <td>
                  {(p.role !== 'ceo' || me.role === 'ceo') && (
                    <button className="link" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing !== undefined && (
        <UserForm
          editing={editing}
          people={people}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
            notify('User saved', 'success');
          }}
        />
      )}
    </div>
  );
}
