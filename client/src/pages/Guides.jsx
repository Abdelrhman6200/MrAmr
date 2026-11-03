import { useState } from 'react';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';

// The video guide for each role (Arabic, in /public/guides): watch it here or
// download it to share. Your own role's guide comes first.
export const GUIDES = [
  'ceo',
  'ops_manager',
  'ops_member',
  'head_of_content',
  'instructor',
  'media_producer',
  'academic_head',
  'assistant',
  'halls_head',
  'marketing_manager',
  'marketing_member',
  'sysops_manager',
  'content_quality',
  'ops_qc',
  'cs_head',
  'cs_team_lead',
  'cs_member',
  'product_owner',
  'platform_member',
];
const file = (role) => `/guides/${String(GUIDES.indexOf(role) + 1).padStart(2, '0')}-${role}.mp4`;

export default function Guides() {
  const { user, t, roleLabel } = useApp();
  const mine = GUIDES.includes(user.role) ? user.role : null;
  const [playing, setPlaying] = useState(mine);
  const others = GUIDES.filter((r) => r !== mine);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('guides.title')}</h1>
          <p className="muted">{t('guides.intro')}</p>
        </div>
      </div>

      {playing && (
        <section className="panel guide-player">
          <div className="panel-head">
            <h2>
              {roleLabel(playing)}
              {playing === mine && <span className="pill status-done">{t('guides.yours')}</span>}
            </h2>
            <a className="btn" href={file(playing)} download>
              <Icon name="download" size={15} /> {t('guides.download')}
            </a>
          </div>
          <video key={playing} src={file(playing)} controls preload="metadata" playsInline />
        </section>
      )}

      <section className="panel">
        <h2>{t('guides.all')}</h2>
        <ul className="guide-list">
          {(mine ? [mine, ...others] : GUIDES).map((role) => (
            <li key={role} className={role === playing ? 'active' : ''}>
              <button className="link guide-name" onClick={() => setPlaying(role)}>
                <Icon name="eye" size={15} /> {roleLabel(role)}
              </button>
              <a className="btn sm" href={file(role)} download>
                <Icon name="download" size={14} /> {t('guides.download')}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
