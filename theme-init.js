// Apply preference before paint, without making content depend on storage access.
(() => {
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try {
    const saved = localStorage.getItem('mindos-theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch { /* Storage can be disabled; use the system preference. */ }
  document.documentElement.dataset.theme = theme;
})();
