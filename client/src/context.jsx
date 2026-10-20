import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState(null);
  const [users, setUsers] = useState([]);
  const [booting, setBooting] = useState(true);
  // Bumped after any mutation so mounted views refetch.
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  useEffect(() => {
    (async () => {
      try {
        setMeta(await api.get('/meta'));
        if (getToken()) setUser((await api.get('/auth/me')).user);
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user) api.get('/users').then(setUsers).catch(() => {});
  }, [user, version]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
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
    const roleLabel = (role) => meta?.roles[role]?.label ?? role;
    const deptOf = (role) => meta?.roles[role]?.department;
    return {
      user,
      setUser,
      meta,
      users,
      booting,
      version,
      refresh,
      login,
      logout,
      notify,
      toast,
      roleLabel,
      deptOf,
      deptLabel: (d) => meta?.departments[d]?.label ?? d,
      deptColor: (d) => meta?.departments[d]?.color ?? '#64748b',
      isManager: user ? meta?.roles[user.role]?.level !== 'member' : false,
      isUserAdmin: user ? meta?.userAdminRoles.includes(user.role) : false,
      userById: (id) => users.find((u) => u.id === id),
    };
  }, [user, meta, users, booting, version, refresh, logout, notify, toast]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
