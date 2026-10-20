// Cliente API con renovación automática de sesión (refresh cookie httpOnly).
let accessToken = null;
let onSessionExpired = null;

export function setAccessToken(t) { accessToken = t; }
export function setSessionExpiredHandler(fn) { onSessionExpired = fn; }

export class ApiError extends Error {
  constructor(status, message, code, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.violations = data?.violations;
  }
}

let refreshPromise = null;

async function doRefresh() {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'Sesión expirada');
  const data = await res.json();
  accessToken = data.access_token;
  return data;
}

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function api(method, path, body) {
  const call = async () => fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let res = await call();

  // Token caducado → intentar renovar una vez y repetir
  if (res.status === 401 && accessToken) {
    try {
      await refreshSession();
      res = await call();
    } catch {
      accessToken = null;
      onSessionExpired?.();
      throw new ApiError(401, 'Tu sesión ha caducado. Inicia sesión de nuevo.');
    }
  }

  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.code, data);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

// Descarga autenticada de archivos (p. ej. exportación Excel)
export async function download(path, filename) {
  const call = () => fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  let res = await call();
  if (res.status === 401 && accessToken) {
    await refreshSession();
    res = await call();
  }
  if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar el archivo');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
