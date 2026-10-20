import { useState } from 'react';
import { useApp } from '../context.jsx';

const DEMO = [
  ['Head of Company', 'ceo@taskflow.local'],
  ['Operations Manager', 'ops@taskflow.local'],
  ['Head of Content', 'content.head@taskflow.local'],
  ['Instructor', 'instructor1@taskflow.local'],
  ['Marketing Manager', 'marketing@taskflow.local'],
  ['Systems Ops', 'sysops@taskflow.local'],
  ['Content Quality', 'quality@taskflow.local'],
  ['Ops QC', 'qc@taskflow.local'],
  ['Head of Customer Service', 'cs.head@taskflow.local'],
  ['Customer Service', 'support1@taskflow.local'],
  ['Product Owner', 'product@taskflow.local'],
];

export default function Login() {
  const { login } = useApp();
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
        <div className="brand big">
          <span className="logo">✓</span> TaskFlow
        </div>
        <p className="muted">Plan, assign and review work across content, marketing, operations, support and product.</p>
        {error && <div className="alert error">{error}</div>}
        <label>
          Email
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <details className="demo">
          <summary>Demo accounts (password: password123)</summary>
          <div className="demo-grid">
            {DEMO.map(([label, em]) => (
              <button
                type="button"
                key={em}
                className="chip"
                onClick={() => {
                  setEmail(em);
                  setPassword('password123');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </details>
      </form>
    </div>
  );
}
