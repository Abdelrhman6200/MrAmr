import { useApp } from '../context.jsx';
import { LanguageSwitch, Logo } from './Layout.jsx';
import Icon from './Icon.jsx';

// Sign-in, first-run set-up and password pages: brand panel + a focused form.
export default function AuthShell({ children }) {
  const { t } = useApp();
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="brand big">
          <Logo size={34} /> TaskFlow
        </div>
        <div className="auth-pitch">
          <h1>{t('auth.headline')}</h1>
          <p>{t('app.tagline')}</p>
          <ul>
            {['auth.point1', 'auth.point2', 'auth.point3'].map((k) => (
              <li key={k}>
                <span className="auth-tick">
                  <Icon name="check" size={14} strokeWidth={2.5} />
                </span>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <small className="auth-foot">TaskFlow</small>
      </aside>
      <main className="auth-main">
        <div className="auth-top">
          <div className="brand auth-mobile-brand">
            <Logo /> TaskFlow
          </div>
          <LanguageSwitch />
        </div>
        <div className="auth-body">{children}</div>
      </main>
    </div>
  );
}
