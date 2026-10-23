import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import AuthShell from '../components/AuthShell.jsx';

export default function ResetPassword() {
  const { t, signIn } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [account, setAccount] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/auth/reset/${encodeURIComponent(token)}`)
      .then(setAccount)
      .catch(() => setInvalid(true));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError(t('reset.mismatch'));
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/reset', { token, password });
      signIn(res.token, res.user);
      navigate('/', { replace: true });
    } catch (err) {
      if (err.code === 'reset_invalid') setInvalid(true);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form className="login-card" onSubmit={submit}>
        <div className="auth-heading">
          <h2>{t('reset.title')}</h2>
        </div>
        {invalid ? (
          <div className="alert error">{t('reset.invalid')}</div>
        ) : (
          <>
            {account && <p className="muted">{t('reset.for', account)}</p>}
            {error && <div className="alert error">{error}</div>}
            <label>
              {t('reset.new')}
              <input type="password" required minLength={8} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">{t('users.passwordHint')}</span>
            </label>
            <label>
              {t('reset.confirm')}
              <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn primary block" disabled={busy || !account}>
              {t('reset.save')}
            </button>
          </>
        )}
        <button type="button" className="link" onClick={() => navigate('/', { replace: true })}>
          {t('login.back')}
        </button>
      </form>
    </AuthShell>
  );
}
