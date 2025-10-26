const DEFAULT_PROD_BASE = '';
const DEFAULT_LOCAL_BASE = 'http://localhost:3005';

function resolveApiBase(){
  if (typeof window === 'undefined') {
    return DEFAULT_PROD_BASE;
  }
  if (window.GEO_API_BASE) {
    return window.GEO_API_BASE;
  }
  const host = window.location && window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return DEFAULT_LOCAL_BASE;
  }
  return DEFAULT_PROD_BASE;
}

export const API_BASE = resolveApiBase();

export function apiFetch(path, options){
  if (!path) {
    throw new Error('apiFetch requires a path');
  }
  if (/^https?:\/\//i.test(path)) {
    return fetch(path, options);
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${API_BASE}${normalized}`, options);
}

export function withApiBase(path){
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}
