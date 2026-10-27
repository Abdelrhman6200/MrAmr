import { useState } from 'react';
import { api, setToken } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag } from '../components/ui.jsx';
import { LanguageSwitch } from '../components/Layout.jsx';
import { MyLeave } from './Leave.jsx';

// Phone number for WhatsApp notifications.
function WhatsAppSettings() {
  const { user, setUser, meta, notify, t } = useApp();
  const [phone, setPhone] = useState(user.phone || '');
  const save = async (patch) => {
    try {
      const u = await api.patch(`/users/${user.id}`, patch);
      setUser({ ...user, ...u });
      notify(t('settings.updated'), 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <section className="panel">
      <h2>{t('wa.title')}</h2>
      <p className="muted">{t('wa.hint')}</p>
      <form
        className="row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          save({ phone });
        }}
      >
        <input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
        <button className="btn">{t('common.save')}</button>
      </form>
      <label className="check">
        <input type="checkbox" checked={user.whatsapp_notifications !== false} onChange={(e) => save({ whatsapp_notifications: e.target.checked })} /> {t('wa.on')}
      </label>
      {!meta.whatsappEnabled && <p className="muted sm">{t('wa.off')}</p>}
    </section>
  );
}

export default function Settings() {
  const { user, setUser, roleLabel, deptOf, userById, notify, refresh, t, meta } = useApp();
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
      notify(t('settings.updated'), 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/auth/change-password', pw);
      // Other devices are signed out; keep this one signed in with the new token.
      setToken(res.token);
      setPw({ currentPassword: '', newPassword: '' });
      notify(t('settings.signedOutOthers'), 'success');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page narrow">
      <h1>{t('settings.title')}</h1>
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
              {manager && <span className="muted">{t('settings.reportsTo', { name: manager.name })}</span>}
            </div>
          </div>
        </div>
        <form className="form" onSubmit={saveProfile}>
          <label>
            {t('settings.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {t('settings.jobTitle')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={roleLabel(user.role)} />
          </label>
          <div>
            <button className="btn primary">{t('settings.saveProfile')}</button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>{t('settings.language')}</h2>
        <p className="muted">{t('settings.languageHint')}</p>
        <LanguageSwitch />
      </section>
      <section className="panel">
        <h2>{t('settings.emailNotif')}</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={user.email_notifications !== false}
            onChange={async (e) => {
              // Flip immediately; undo if the server refuses.
              const on = e.target.checked;
              setUser({ ...user, email_notifications: on });
              try {
                await api.patch(`/users/${user.id}`, { email_notifications: on });
              } catch (err) {
                setUser({ ...user, email_notifications: !on });
                notify(err.message, 'error');
              }
            }}
          />{' '}
          {t('settings.emailNotifHint', { email: user.email })}
        </label>
        {!meta.emailEnabled && <p className="muted sm">{t('settings.emailOff')}</p>}
      </section>
      <WhatsAppSettings />
      <MyLeave />
      <section className="panel">
        <h2>{t('settings.changePassword')}</h2>
        <form className="form" onSubmit={changePassword}>
          {error && <div className="alert error">{error}</div>}
          <label>
            {t('settings.current')}
            <input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </label>
          <label>
            {t('settings.new')}
            <input type="password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </label>
          <div>
            <button className="btn">{t('settings.changePassword')}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
