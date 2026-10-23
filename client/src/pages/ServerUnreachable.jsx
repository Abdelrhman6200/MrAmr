import { API_BASE } from '../api.js';
import { useApp } from '../context.jsx';
import AuthShell from '../components/AuthShell.jsx';

// Shown when the web app can't reach its API — usually a deployment setting.
export default function ServerUnreachable() {
  const { t, retryBoot, bootError } = useApp();
  const sameSite = API_BASE.startsWith('/');
  const setup = bootError?.code === 'server_misconfigured';
  const address = sameSite ? `${window.location.origin}${API_BASE}` : API_BASE;
  return (
    <AuthShell>
      <div className="login-card">
        <h2 style={{ margin: 0 }}>{t(setup ? 'offline.setupTitle' : 'offline.title')}</h2>
        <p className="muted">{t(setup ? 'offline.setupBody' : 'offline.body')}</p>
        {setup && bootError.reason && (
          <code dir="ltr" className="code-box">
            {bootError.reason}
          </code>
        )}
        {!setup && (
          <div className="field">
            <span className="field-label">{t('offline.address')}</span>
            <code dir="ltr" className="code-box">
              {address}
            </code>
          </div>
        )}
        <div className="alert info sm">{t(setup ? 'offline.hintSetup' : sameSite ? 'offline.hintMissing' : 'offline.hintDown')}</div>
        <button className="btn primary block" onClick={retryBoot}>
          {t('offline.retry')}
        </button>
      </div>
    </AuthShell>
  );
}
