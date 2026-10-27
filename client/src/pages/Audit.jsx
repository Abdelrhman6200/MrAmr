import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Empty, Spinner, formatDateTime } from '../components/ui.jsx';

// Who changed what (for the Head of Company and the Operations Manager).
export default function Audit() {
  const { t } = useApp();
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(true);
  const load = async (before) => {
    const page = await api.get('/admin/audit', { before });
    setRows((r) => [...(before ? r : []), ...page]);
    setMore(page.length === 100);
  };
  useEffect(() => {
    load().catch(() => setRows([]));
  }, []);

  // "role: instructor → assistant", "name: Rana", …
  const describe = (d) =>
    d && typeof d === 'object'
      ? Object.entries(d)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v[0] ?? '—'} → ${v[1] ?? '—'}` : v}`)
          .join(' · ')
      : String(d || '');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('audit.title')}</h1>
          <p className="muted">{t('audit.intro')}</p>
        </div>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon="note">{t('audit.none')}</Empty>
      ) : (
        <section className="panel flush">
          <table className="table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted sm nowrap">{formatDateTime(r.created_at)}</td>
                  <td>
                    <b>{r.user_name || '—'}</b> · {r.action} {r.entity}
                    <div className="muted sm">{describe(r.detail)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <div className="row gap" style={{ padding: 12 }}>
              <button className="btn sm" onClick={() => load(rows.at(-1).id)}>
                {t('audit.more')}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
