const THEME_KEY = 'lr_theme';
const THEMES = ['light', 'dark'];
const FALLBACK_THEME = 'light';

function normalizeTheme(value) {
  return THEMES.includes(value) ? value : FALLBACK_THEME;
}

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (!stored) return null;
    return normalizeTheme(stored);
  } catch {
    return null;
  }
}

function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, normalizeTheme(theme));
  } catch {}
}

function readDomTheme() {
  if (typeof document === 'undefined') return null;
  const attr = document.documentElement?.getAttribute('data-theme');
  return attr ? normalizeTheme(attr) : null;
}

function setDomTheme(theme) {
  const resolved = normalizeTheme(theme);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const body = document.body;
    if (root) {
      root.setAttribute('data-theme', resolved);
      root.classList.toggle('dark', resolved === 'dark');
    }
    if (body) {
      body.setAttribute('data-theme', resolved);
      body.classList.toggle('dark', resolved === 'dark');
    }
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const event = new CustomEvent('lr:theme-change', { detail: { theme: resolved } });
    window.dispatchEvent(event);
  }
  return resolved;
}

export function applyTheme(theme) {
  const resolved = setDomTheme(theme || getStoredTheme() || FALLBACK_THEME);
  persistTheme(resolved);
  return resolved;
}

export function initTheme() {
  const stored = getStoredTheme();
  const initial = stored || FALLBACK_THEME;
  persistTheme(initial);
  return setDomTheme(initial);
}

export function getActiveTheme() {
  return readDomTheme() || getStoredTheme() || FALLBACK_THEME;
}

export function nextTheme(currentTheme) {
  const normalized = normalizeTheme(currentTheme);
  const currentIndex = THEMES.indexOf(normalized);
  const nextIndex = (currentIndex + 1) % THEMES.length;
  return THEMES[nextIndex];
}
