import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setErrorTranslator, setToken, setUnauthorizedHandler } from './api.js';
import { DICTS, localeOf, setActiveLocale, translate, translateError } from './i18n.js';

const LANG_KEY = 'taskflow.lang';
function storedLang() {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}
const browserLang = () => (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState(null);
  const [users, setUsers] = useState([]);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState(null);
  // Bumped after any mutation so mounted views refetch.
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState(null);
  const [lang, setLangState] = useState(() => storedLang() || browserLang());

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    setErrorTranslator((m) => translateError(lang, m));
  }, [lang]);

  // A choice made on this device wins; otherwise use the account's saved language.
  const adoptUserLang = (u) => {
    if (!storedLang() && (u.language === 'ar' || u.language === 'en')) setLangState(u.language);
  };

  const setLang = useCallback((next) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* storage unavailable */
    }
    setUser((u) => {
      if (u && u.language !== next) api.patch(`/users/${u.id}`, { language: next }).catch(() => {});
      return u ? { ...u, language: next } : u;
    });
  }, []);

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      setMeta(await api.get('/meta'));
      if (getToken()) {
        const me = (await api.get('/auth/me')).user;
        adoptUserLang(me);
        setUser(me);
      }
    } catch (err) {
      // Only a rejected login clears it; a network blip must not sign people out.
      if (err.status === 401) setToken(null);
      else setBootError(err.code === 'server_unreachable' ? 'server_unreachable' : 'unknown');
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (user) api.get('/users').then(setUsers).catch(() => {});
  }, [user, version]);

  const signIn = (token, u) => {
    setToken(token);
    adoptUserLang(u);
    setUser(u);
  };

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    signIn(res.token, res.user);
  };

  const notify = useCallback((message, kind = 'info') => {
    setToast({ message, kind, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo(() => {
    const t = (key, vars) => translate(lang, key, vars);
    // Server lists carry English labels; Arabic comes from the dictionary.
    const label = (prefix, key, english) => (lang === 'ar' && DICTS.ar[`${prefix}.${key}`]) || english || key;
    const find = (list, key) => list?.find((x) => x.key === key)?.label;
    const roleLabel = (role) => label('role', role, meta?.roles[role]?.label);
    const deptOf = (role) => meta?.roles[role]?.department;
    const locale = localeOf(lang);
    setActiveLocale(locale);
    return {
      lang,
      setLang,
      t,
      locale,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      statusLabel: (k) => label('status', k, find(meta?.statuses, k)),
      priorityLabel: (k) => label('priority', k, find(meta?.priorities, k)),
      typeLabel: (k) => label('type', k, find(meta?.taskTypes, k)),
      projectStatusLabel: (k) => label('pstatus', k, find(meta?.projectStatuses, k)),
      callStatusLabel: (k) => label('callStatus', k, find(meta?.callStatuses, k)),
      canUseCalls: user ? user.role === 'ceo' || meta?.roles[user.role]?.department === 'customer_service' : false,
      user,
      setUser,
      meta,
      users,
      booting,
      bootError,
      retryBoot: boot,
      version,
      refresh,
      login,
      signIn,
      logout,
      notify,
      toast,
      roleLabel,
      deptOf,
      deptLabel: (d) => label('dept', d, meta?.departments[d]?.label),
      deptColor: (d) => meta?.departments[d]?.color ?? '#64748b',
      isManager: user ? meta?.roles[user.role]?.level !== 'member' : false,
      isUserAdmin: user ? meta?.userAdminRoles.includes(user.role) : false,
      userById: (id) => users.find((u) => u.id === id),
    };
  }, [user, meta, users, booting, bootError, boot, version, refresh, logout, notify, toast, lang, setLang]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
