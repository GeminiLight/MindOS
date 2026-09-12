// Motion enhances already-visible content. Selection, links, and focus never wait for it.
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const active = new Map();
export function stopMotion(element) {
  active.get(element)?.cancel();
  active.delete(element);
}
function animate(element, frames, duration = 240) {
  if (!element) return;
  stopMotion(element);
  if (preference.matches || document.hidden || typeof element.animate !== 'function') return;
  const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.2,.7,.2,1)' });
  active.set(element, animation);
  animation.finished.catch(() => {}).then(() => {
    if (active.get(element) === animation) active.delete(element);
  });
}
function cancelAll() {
  for (const animation of active.values()) animation.cancel();
  active.clear();
}
preference.addEventListener('change', () => { if (preference.matches) cancelAll(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAll(); });

export function revealPanel(element, direction = 1) {
  animate(element, [
    { opacity: .55, transform: `translateX(${direction * 8}px)` },
    { opacity: 1, transform: 'translateX(0)' },
  ]);
}

export function mountTabIndicator(list, tabs) {
  const marker = document.createElement('span');
  marker.className = 'tab-indicator';
  marker.setAttribute('aria-hidden', 'true');
  list.prepend(marker);
  list.classList.add('has-indicator');
  const update = (withMotion = false) => {
    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
    if (!selected?.offsetWidth) return;
    // Read the interrupted animation's actual position before resetting its final geometry.
    const before = marker.getBoundingClientRect();
    const parent = list.getBoundingClientRect();
    const width = selected.offsetWidth;
    const left = selected.offsetLeft;
    stopMotion(marker);
    marker.style.width = width + 'px';
    marker.style.transform = `translateX(${left}px)`;
    if (withMotion && before.width) animate(marker, [
      { transform: `translateX(${before.left - parent.left - list.clientLeft}px) scaleX(${before.width / width})` },
      { transform: `translateX(${left}px) scaleX(1)` },
    ], 220);
  };
  requestAnimationFrame(() => update());
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => update()).observe(list);
  else window.addEventListener('resize', () => update(), { passive: true });
  return () => update(true);
}

export function mountPageMotion() {
  const header = document.querySelector('.site-header');
  const links = [...document.querySelectorAll('#site-nav a')].flatMap(link => {
    const url = new URL(link.href);
    const target = url.pathname === location.pathname && url.hash ? document.getElementById(url.hash.slice(1)) : null;
    return target ? [{ link, target }] : [];
  });
  let frame = 0;
  const updateReadingPosition = () => {
    frame = 0;
    if (!header) return;
    const range = document.documentElement.scrollHeight - innerHeight;
    header.style.setProperty('--reading-progress', String(range > 0 ? Math.max(0, Math.min(1, scrollY / range)) : 0));
    header.dataset.scrolled = String(scrollY > 16);
    const line = Math.max(header.getBoundingClientRect().bottom + 24, innerHeight * .3);
    for (const { link, target } of links) {
      const bounds = target.getBoundingClientRect();
      if (bounds.top <= line && bounds.bottom > line) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(updateReadingPosition); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(document.body);
  updateReadingPosition();

  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        animate(entry.target, [
          { opacity: .65, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], 280);
      }
    }, { threshold: .12 });
    document.querySelectorAll('.hero-copy, .constellation-art, .section-heading, .evolution-intro, .principle-grid article, .first-loop, .faq-intro, .article-body section').forEach(element => observer.observe(element));
  }

  document.querySelectorAll('.faq-list details, .agent-install').forEach(details => {
    details.addEventListener('toggle', () => {
      for (const child of details.children) if (child.tagName !== 'SUMMARY') {
        if (details.open) animate(child, [{ opacity: .5, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], 200);
        else stopMotion(child);
      }
      schedule();
    });
  });
}
