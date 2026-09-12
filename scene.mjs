// Continuous hero motion is optional; the base SVG remains complete and readable.
export function mountSceneMotion() {
  const scene = document.querySelector('[data-constellation]');
  if (!scene || typeof IntersectionObserver !== 'function') return;
  const button = scene.querySelector('.scene-motion-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  let visible = false;
  function sync() {
    scene.toggleAttribute('data-scene-resting', paused || !visible || document.hidden || reduced.matches);
    scene.toggleAttribute('data-scene-reduced', reduced.matches);
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? button.dataset.playLabel : button.dataset.pauseLabel);
  }
  button.addEventListener('click', () => { paused = !paused; sync(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .1 }).observe(scene);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  sync();
  scene.setAttribute('data-scene-ready', '');
}
