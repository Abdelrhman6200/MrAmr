import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import AuthShell from '../components/AuthShell.jsx';

const DEMO = [
  ['ceo', 'ceo@taskflow.local'],
  ['ops_manager', 'ops@taskflow.local'],
  ['head_of_content', 'content.head@taskflow.local'],
  ['instructor', 'instructor1@taskflow.local'],
  ['marketing_manager', 'marketing@taskflow.local'],
  ['sysops_manager', 'sysops@taskflow.local'],
  ['content_quality', 'quality@taskflow.local'],
  ['ops_qc', 'qc@taskflow.local'],
  ['cs_head', 'cs.head@taskflow.local'],
  ['cs_member', 'support1@taskflow.local'],
  ['product_owner', 'product@taskflow.local'],
];

export default function Login() {
  const { login, t, roleLabel, meta } = useApp();
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (forgot) {
        await api.post('/auth/forgot', { email });
        setSent(true);
        return;
      }
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form className="login-card" onSubmit={submit}>
        {!forgot && (
          <div className="auth-heading">
            <h2>{t('auth.welcome')}</h2>
            <p className="muted">{t('auth.welcomeHint')}</p>
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        {forgot ? (
          <>
            <div className="auth-heading">
              <h2>{t('login.forgotTitle')}</h2>
            </div>
            {!meta.resetByEmail ? (
              <div className="alert info">{t('login.noEmail')}</div>
            ) : sent ? (
              <div className="alert info">{t('login.linkSent')}</div>
            ) : (
              <p className="muted">{t('login.forgotHint')}</p>
            )}
          </>
        ) : null}
        {(!forgot || (meta.resetByEmail && !sent)) && (
          <label>
            {t('login.email')}
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {!forgot && (
          <label>
            {t('login.password')}
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {(!forgot || (meta.resetByEmail && !sent)) && (
          <button className="btn primary block" disabled={busy}>
            {forgot ? t('login.sendLink') : busy ? t('login.signingIn') : t('login.signIn')}
          </button>
        )}
        <button
          type="button"
          className="link"
          onClick={() => {
            setForgot(!forgot);
            setSent(false);
            setError('');
          }}
        >
          {forgot ? t('login.back') : t('login.forgot')}
        </button>
        {meta.demo && !forgot && (
        <details className="demo">
          <summary>{t('login.demo')}</summary>
          <div className="demo-grid">
            {DEMO.map(([role, em]) => (
              <button
                type="button"
                key={em}
                className="chip"
                onClick={() => {
                  setEmail(em);
                  setPassword('password123');
                }}
              >
                {roleLabel(role)}
              </button>
            ))}
          </div>
        </details>
        )}
      </form>
    </AuthShell>
  );
}
