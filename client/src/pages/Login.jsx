import { useState } from 'react';
import { useApp } from '../context.jsx';
import { LanguageSwitch } from '../components/Layout.jsx';

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
  const { login, t, roleLabel } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
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
        <p className="muted">{t('app.tagline')}</p>
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('login.email')}
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('login.password')}
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary block" disabled={busy}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
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
      </form>
    </div>
  );
}
