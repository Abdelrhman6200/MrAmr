import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { LanguageSwitch } from '../components/Layout.jsx';

// First run on a new deployment: create the Head of Company account.
export default function Setup() {
  const { t, signIn, lang } = useApp();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/setup', { ...form, language: lang });
      signIn(res.token, res.user);
    } catch (err) {
      if (err.code === 'already_setup') window.location.reload();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="row between wrap gap">
          <div className="brand big">
            <span className="logo">✓</span> TaskFlow
          </div>
          <LanguageSwitch />
        </div>
        <h2 style={{ margin: 0 }}>{t('setup.title')}</h2>
        <p className="muted">{t('setup.body')}</p>
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('setup.name')}
          <input required autoFocus maxLength={120} value={form.name} onChange={set('name')} />
        </label>
        <label>
          {t('login.email')}
          <input type="email" required value={form.email} onChange={set('email')} />
        </label>
        <label>
          {t('login.password')}
          <input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
        </label>
        <button className="btn primary block" disabled={busy}>
          {busy ? t('setup.busy') : t('setup.submit')}
        </button>
        <div className="alert info sm">{t('setup.note')}</div>
      </form>
    </div>
  );
}
