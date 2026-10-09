import { panelPalette } from '../../popover/ui/panel-palette.mjs';
import { THEME_VARIABLES } from '../../popover/ui/theme-appearance.mjs';
import { localizeDocument, onLocaleChanged, setLocale } from './i18n.mjs';

function createInterfacePresentation({ document, window, client }) {
  const query = window.matchMedia('(prefers-color-scheme: light)');
  let snapshot = { theme: 'system', resolvedLocale: 'zh-CN', revision: -1 };
  let disposed = false, mounted = false, readId = 0;
  const listeners = [];
  function paint() {
    if (disposed) return;
    const appearance = snapshot.theme === 'system' ? (query.matches ? 'light' : 'dark') : snapshot.theme;
    const root = document.documentElement;
    root.dataset.appearance = appearance;
    root.dataset.themePreference = snapshot.theme;
    root.style.colorScheme = appearance;
    const palette = panelPalette(appearance);
    // Pet artwork uses its own primary/accent variables. Its surrounding menu
    // chrome receives only the independent --ui-* variables below.
    if (document.body.dataset.surface !== 'pet') {
      for (const [name, variable] of Object.entries(THEME_VARIABLES)) root.style.setProperty(variable, palette[name]);
    }
    for (const [name, value] of Object.entries({
      '--ui-bg': palette.bg1, '--ui-fg': palette.fg0, '--ui-fg-2': palette.fg2,
      '--ui-primary': palette.primary, '--ui-ink': palette.ink,
      '--ui-line': appearance === 'light' ? '#26282b33' : '#f2f0ed33',
      '--line': appearance === 'light' ? '#26282b26' : '#f2f0ed26',
      '--line-strong': appearance === 'light' ? '#26282b55' : '#f2f0ed55',
      '--danger': appearance === 'light' ? '#ac263c' : '#ffabb5'
    })) root.style.setProperty(name, value);
  }
  function accept(next) {
    if (disposed || !next || !Number.isSafeInteger(next.revision) || next.revision < snapshot.revision
        || !['system', 'light', 'dark'].includes(next.theme) || !['zh-CN', 'en'].includes(next.resolvedLocale)) return;
    snapshot = { ...next };
    setLocale(snapshot.resolvedLocale);
    localizeDocument(document);
    paint();
  }
  async function refresh() {
    const id = ++readId;
    try { const next = await client.read(); if (id === readId) accept(next); }
    catch (_) { /* Keep the last acknowledged presentation; never write a fallback. */ }
  }
  function mount() {
    if (mounted || disposed) return Promise.resolve();
    mounted = true;
    listeners.push(client.subscribe(accept), onLocaleChanged(() => localizeDocument(document)));
    query.addEventListener('change', paint);
    window.addEventListener('focus', refresh);
    paint();
    return refresh();
  }
  function dispose() {
    disposed = true; readId++;
    query.removeEventListener('change', paint);
    window.removeEventListener('focus', refresh);
    for (const stop of listeners.splice(0)) stop?.();
  }
  return Object.freeze({ mount, dispose, refresh });
}
export { createInterfacePresentation };
