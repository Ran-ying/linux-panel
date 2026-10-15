// Browser-only appearance preferences. No private server/account state is used.
export const THEME_STORAGE_KEY = 'linux-panel-theme';
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : 'system';
}

export function resolveTheme(preference, systemDark = false) {
  const choice = normalizeThemePreference(preference);
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}

export function createThemeController({ root, getStorage, mediaQuery } = {}) {
  if (!root?.setAttribute) throw new TypeError('Theme root is required');
  let preference = 'system';
  const storage = () => {
    try { return getStorage?.() ?? null; }
    catch { return null; } // storage can be disabled by privacy settings
  };
  try { preference = normalizeThemePreference(storage()?.getItem(THEME_STORAGE_KEY)); }
  catch { /* inaccessible storage must not prevent the login page loading */ }

  const apply = () => {
    const theme = resolveTheme(preference, Boolean(mediaQuery?.matches));
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    return theme;
  };
  const setPreference = (next) => {
    preference = normalizeThemePreference(next);
    try { storage()?.setItem(THEME_STORAGE_KEY, preference); }
    catch { /* keep the user's in-memory choice for this tab */ }
    apply();
    return preference;
  };
  const onSystemChange = () => {
    if (preference === 'system') apply();
  };
  mediaQuery?.addEventListener?.('change', onSystemChange);
  // Legacy MediaQueryList implementations.
  if (!mediaQuery?.addEventListener) mediaQuery?.addListener?.(onSystemChange);
  apply(); // paint with the correct theme before mounting Vue
  return {
    getPreference: () => preference,
    setPreference,
    getEffectiveTheme: () => resolveTheme(preference, Boolean(mediaQuery?.matches)),
    dispose: () => {
      mediaQuery?.removeEventListener?.('change', onSystemChange);
      if (!mediaQuery?.removeEventListener) mediaQuery?.removeListener?.(onSystemChange);
    }
  };
}
