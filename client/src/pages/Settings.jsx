import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag } from '../components/ui.jsx';

export default function Settings() {
  const { user, setUser, roleLabel, deptOf, userById, notify, refresh } = useApp();
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title || '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const manager = userById(user.manager_id);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      const u = await api.patch(`/users/${user.id}`, { name, title });
      setUser({ ...user, ...u });
      refresh();
      notify('Profile updated', 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      notify('Password changed', 'success');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page narrow">
      <h1>Your profile</h1>
      <section className="panel">
        <div className="row gap">
          <Avatar name={user.name} color={user.avatar_color} size={56} />
          <div>
            <h2 style={{ margin: 0 }}>{user.name}</h2>
            <div className="muted">
              {roleLabel(user.role)} · {user.email}
            </div>
            <div className="row gap-sm sm">
              <DeptTag department={deptOf(user.role)} />
              {manager && <span className="muted">Reports to {manager.name}</span>}
            </div>
          </div>
        </div>
        <form className="form" onSubmit={saveProfile}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Job title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={roleLabel(user.role)} />
          </label>
          <div>
            <button className="btn primary">Save profile</button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>Change password</h2>
        <form className="form" onSubmit={changePassword}>
          {error && <div className="alert error">{error}</div>}
          <label>
            Current password
            <input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </label>
          <label>
            New password
            <input type="password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </label>
          <div>
            <button className="btn">Change password</button>
          </div>
        </form>
      </section>
    </div>
  );
}
