// Progressive enhancement: without JS, the original list remains scrollable.
export function mountAgentMarquee() {
  const strip = document.querySelector('[data-agent-marquee]');
  if (!strip) return;
  const viewport = strip.querySelector('.agent-viewport');
  const button = strip.querySelector('[data-marquee-toggle]');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  function toggleLabel() {
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? button.dataset.playLabel : button.dataset.pauseLabel);
    strip.toggleAttribute('data-paused', paused);
  }
  button.addEventListener('click', () => {
    paused = !paused;
    if (!paused) { strip.removeAttribute('data-manual'); viewport.scrollLeft = 0; }
    toggleLabel();
  });
  function manual() { strip.setAttribute('data-manual', ''); paused = true; toggleLabel(); }
  viewport.addEventListener('focus', manual);
  viewport.addEventListener('pointerdown', manual);
  viewport.addEventListener('wheel', event => { if (event.deltaX || event.shiftKey) manual(); }, { passive: true });
  viewport.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); manual();
    viewport.scrollLeft = event.key === 'Home' ? 0 : event.key === 'End' ? viewport.scrollWidth : viewport.scrollLeft + (event.key === 'ArrowLeft' ? -180 : 180);
  });
  function syncPreference() {
    strip.toggleAttribute('data-reduced', preference.matches);
    if (preference.matches) viewport.scrollLeft = 0;
  }
  syncPreference(); preference.addEventListener('change', syncPreference);
  const syncVisibility = () => strip.toggleAttribute('data-hidden', document.hidden);
  syncVisibility(); document.addEventListener('visibilitychange', syncVisibility);
  if (typeof IntersectionObserver === 'function') {
    strip.setAttribute('data-offscreen', '');
    new IntersectionObserver(([entry]) => strip.toggleAttribute('data-offscreen', !entry.isIntersecting)).observe(strip);
  }
  strip.setAttribute('data-ready', '');
}
