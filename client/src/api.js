const TOKEN_KEY = 'taskflow.token';

// Where the API lives: the same site by default (on Vercel it's the api/ function).
// Only if the API is hosted elsewhere, set VITE_API_URL at build time to its address.
export const API_BASE = `${(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')}/api`;

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

export class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = () => {};
let translateMessage = (m) => m;
export const setErrorTranslator = (fn) => (translateMessage = fn);
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

// Thrown when the API can't be reached or something other than the API answered
// (e.g. a static host returning its index.html because VITE_API_URL is missing).
const unreachable = () => new ApiError(0, 'server_unreachable', 'server_unreachable');

async function request(method, path, body) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw unreachable();
  }
  if (res.status === 204) return null;
  if (!(res.headers.get('content-type') || '').includes('application/json')) throw unreachable();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, translateMessage(data.error || res.statusText), data.code, data.details);
  }
  return data;
}

const qs = (params = {}) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p)}` : '';
};

// Downloads an authenticated file response (e.g. a backup) to the user's device.
async function download(path, fallbackName) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, translateMessage(data.error || res.statusText), data.code, data.details);
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  download,
  get: (path, params) => request('GET', path + qs(params), undefined),
  post: (path, body) => request('POST', path, body || {}),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};
