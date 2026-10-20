import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { setAccessToken, setSessionExpiredHandler, refreshSession, get, post } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [booting, setBooting] = useState(true);

  const loadMe = useCallback(async () => {
    const data = await get('/me');
    setUser(data.user);
    setOrg(data.org);
    return data.user;
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setOrg(null);
    });
    (async () => {
      try {
        await refreshSession(); // renueva el access token con la cookie
        await loadMe();
      } catch { /* sin sesión previa */ }
      setBooting(false);
    })();
  }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'No se pudo iniciar sesión');
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    setAccessToken(data.access_token);
    await loadMe();
    return data.user;
  }, [loadMe]);

  const register = useCallback(async (payload) => {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'No se pudo crear la cuenta');
      err.status = res.status;
      throw err;
    }
    setAccessToken(data.access_token);
    await loadMe();
    return data.user;
  }, [loadMe]);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* ignora */ }
    setAccessToken(null);
    setUser(null);
    setOrg(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, org, booting, login, register, logout, reload: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
