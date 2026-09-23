import axios from 'axios';

// Base API instance. In dev, CRA proxy forwards to http://localhost:4000.
// In prod, src/server.js proxies /api to BACKEND_URL.
const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// Fallback helper: if proxy breaks, retry once against direct backend URL
export function directBackendBase() {
  try {
    if (typeof window === 'undefined') throw new Error('no-window');
    const w = window;
    if (w.__BACKEND_ORIGIN__) return w.__BACKEND_ORIGIN__;

    const { protocol = 'http:', hostname = 'localhost', port: locationPort = '' } = w.location || {};
    const overridePort = w.__BACKEND_PORT__;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

    // In local dev the page is never served by the backend, so its own port is
    // never the right target. Listing known frontend ports (3000/5173/4173) got
    // this wrong the moment the dev server fell back to 3001 and the "fallback"
    // pointed at the frontend itself.
    let port = overridePort ?? (isLocal ? '4000' : locationPort);

    const normalizedPort = String(port || '').replace(/^:+/, '');
    const shouldIncludePort = normalizedPort && normalizedPort !== '80' && normalizedPort !== '443';
    // Prefer 127.0.0.1 over localhost to avoid IPv6 (::1) quirks on Windows
    const hostOut = hostname === 'localhost' ? '127.0.0.1' : hostname;
    return `${protocol}//${hostOut}${shouldIncludePort ? `:${normalizedPort}` : ''}`;
  } catch {
    return 'http://localhost:4000';
  }
}

export function resolveMediaUrl(path) {
  if (!path) return '';
  const value = String(path).trim();
  if (!value) return '';
  // Absolute URL or data URI: return as-is
  if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  // For file and static uploads, point directly to backend origin to work in new tabs
  // and outside the dev proxy as well.
  const base = directBackendBase();
  if (value.startsWith('/api/files/')) return `${base}${value}`;
  if (value.startsWith('/api/books/') && value.includes('/pdf')) return `${base}${value}`;
  if (value.startsWith('/uploads/')) return `${base}${value}`;
  // Other API endpoints can use dev proxy
  if (value.startsWith('/api/')) return value;
  if (value.startsWith('/')) return `${base}${value}`;
  return `${base}/${value}`;
}

// Optional auth header helper
export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    try { localStorage.setItem('lr_token', token); } catch {}
  } else {
    delete api.defaults.headers.common['Authorization'];
    try { localStorage.removeItem('lr_token'); } catch {}
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('lr_user');
    if (!raw) return null;
    return JSON.parse(raw);

  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  try {
    if (!user) {
      localStorage.removeItem('lr_user');
    } else {
      localStorage.setItem('lr_user', JSON.stringify(user));
    }
  } catch {}
}

export function hasStoredToken() {
  try {
    return Boolean(localStorage.getItem('lr_token'));
  } catch {
    return false;
  }
}

export function broadcastAuthChange() {
  try {
    window.dispatchEvent(new Event('lr-auth-change'));
  } catch {}
}

export function clearAuthSession() {
  setAuthToken(null);
  setStoredUser(null);
}

export function persistAuthSession({ token, user }) {
  if (typeof token !== 'undefined') {
    setAuthToken(token);
  }
  if (typeof user !== 'undefined') {
    setStoredUser(user);
  }
  broadcastAuthChange();
}

function getStoredRole() {
  const user = getStoredUser();
  return user?.role || null;
}

// Load token on boot if present
try {
  const t = localStorage.getItem('lr_token');
  if (t) setAuthToken(t);
} catch {}

// Redirect to sign-in on 401s
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    if (!status) {
      // Network/connection failure only — retry once directly to backend with CORS.
      // A 404 used to be retried too, from when setupProxy.js stripped the /api
      // prefix and every call 404'd. That is fixed, so a 404 now means "not
      // found": retrying it doubled every request and re-sent POSTs.
      const cfg = err?.config || {};
      if (!cfg.__retriedDirect) {
        cfg.__retriedDirect = true;
        // Keep original URL (likely starts with '/api/...').
        // Point baseURL to backend root to avoid '/api/api/...' duplication.
        const baseURL = `${directBackendBase()}/api`; 
        return axios.request({ ...cfg, baseURL });
      }
    }
    if (typeof window !== 'undefined') {
      const at = (path) => {
        try { return window.location.pathname === path; } catch { return false; }
      };
      if (status === 401 || status === 403) {
        const role = getStoredRole();
        const target = role === 'student' ? '/student/signin' : '/signin';

        clearAuthSession();
        broadcastAuthChange();

        if (!at(target)) window.location.replace(target);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
