import { ambientRotation } from './scene-geometry.mjs';
import { createSceneRenderer } from './scene-renderer.mjs';

// A complete SVG is always present. WebGL replaces it only after a successful frame.
export function mountSceneMotion() {
  const scene = document.querySelector('[data-constellation]');
  if (!scene || typeof IntersectionObserver !== 'function') return;
  const button = scene.querySelector('.scene-motion-toggle');
  const resetButton = scene.querySelector('.scene-reset');
  const canvas = scene.querySelector('.scene-canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false, visible = false, renderer = null, frame = 0, previous = 0, time = 0;
  let yaw = 0, pitch = 0, velocityX = 0, velocityY = 0, drag = null, resetFrame = 0, explored = false, lastAmbient = [0,0];
  const cancelReset = () => { cancelAnimationFrame(resetFrame); resetFrame=0; };
  const moving = () => visible && !document.hidden && !paused && !reduced.matches;
  function stop() {
    cancelAnimationFrame(frame); frame = 0; previous = 0;
    velocityX = velocityY = 0;
  }
  function draw() {
    if (!renderer) return;
    try {
      lastAmbient = !explored && !reduced.matches ? ambientRotation(time) : [0,0];
      renderer.draw(yaw+lastAmbient[0],pitch+lastAmbient[1],time,yaw,pitch);
    }
    catch { fallback(); }
  }
  function takeControl() {
    if (explored) return;
    // Absorb the displayed idle pose so grabbing the sculpture cannot snap its view.
    yaw+=lastAmbient[0]; pitch+=lastAmbient[1]; lastAmbient=[0,0]; explored=true;
  }
  function tick(now) {
    frame = 0;
    if (!renderer || !moving()) return;
    // Ambient light needs only 30fps; direct manipulation and inertia retain full refresh.
    if (previous && !drag && !velocityX && !velocityY && now-previous<30) {
      frame=requestAnimationFrame(tick); return;
    }
    const dt = previous ? Math.min((now-previous)/1000, .05) : 0;
    previous = now; time = (time + dt) % 100;
    if (!drag) {
      yaw += velocityX*dt; pitch += velocityY*dt;
      const friction = Math.exp(-7.5*dt);
      velocityX *= friction; velocityY *= friction;
      if (Math.abs(velocityX)+Math.abs(velocityY)<.002) velocityX=velocityY=0;
    }
    if (!resetFrame) draw();
    if (renderer) frame = requestAnimationFrame(tick);
  }
  function schedule() { if (renderer && moving() && !frame) frame = requestAnimationFrame(tick); }
  function fallback() {
    stop(); cancelReset();
    const pointer=drag?.id; drag = null;
    if (pointer!==undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    scene.removeAttribute('data-scene-dragging');
    renderer?.dispose(); renderer = null; scene.removeAttribute('data-scene-3d');
    if (document.activeElement === canvas || document.activeElement === resetButton) button.focus({ preventScroll: true });
  }
  function initialise() {
    if (!canvas) return;
    try {
      renderer = createSceneRenderer(canvas, scene);
      draw();
      if (!renderer) return;
      scene.setAttribute('data-scene-3d', '');
      schedule();
    } catch { fallback(); }
  }
  function sync() {
    if (reduced.matches) takeControl();
    scene.toggleAttribute('data-scene-resting', !moving());
    scene.toggleAttribute('data-scene-reduced', reduced.matches);
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? button.dataset.playLabel : button.dataset.pauseLabel);
    if (!moving()) stop();
    if ((!visible || document.hidden || reduced.matches) && resetFrame) { cancelReset(); yaw=pitch=0; }
    else schedule();
    draw();
  }
  function reset() {
    cancelReset(); velocityX=velocityY=0;
    if (explored) {
      const target=reduced.matches?[0,0]:ambientRotation(time);
      yaw-=target[0]; pitch-=target[1]; explored=false;
    }
    if (reduced.matches || !visible) { yaw=pitch=0; draw(); return; }
    // Return by the shortest arc, never unwind all the turns the visitor made.
    const wrap = angle => Math.atan2(Math.sin(angle),Math.cos(angle));
    const fromYaw=wrap(yaw),fromPitch=wrap(pitch),start=performance.now();
    function settle(now) {
      const progress=Math.max(0,Math.min((now-start)/260,1)),remain=(1-progress)**3;
      yaw=fromYaw*remain; pitch=fromPitch*remain; draw();
      resetFrame=progress<1?requestAnimationFrame(settle):0;
    }
    resetFrame=requestAnimationFrame(settle);
  }
  button.addEventListener('click', () => { paused = !paused; sync(); });
  resetButton?.addEventListener('click', reset);
  canvas?.addEventListener('dblclick', reset);
  canvas?.addEventListener('keydown', event => {
    if (!renderer || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
    event.preventDefault(); takeControl(); cancelReset(); velocityX = velocityY = 0;
    if (event.key === 'Home') return reset();
    const step = Math.PI/12;
    yaw += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    pitch += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    draw();
  });
  canvas?.addEventListener('pointerdown', event => {
    if (!renderer || event.button !== 0 || !event.isPrimary) return;
    takeControl(); cancelReset(); velocityX = velocityY = 0;
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, at:event.timeStamp, touch:event.pointerType==='touch', active:event.pointerType!=='touch' };
    if (drag.active) {
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll:true });
      scene.setAttribute('data-scene-dragging', '');
    }
  });
  canvas?.addEventListener('pointermove', event => {
    if (!drag || event.pointerId!==drag.id || !renderer) return;
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    if (!drag.active) {
      const horizontal=Math.abs(event.clientX-drag.startX), vertical=Math.abs(event.clientY-drag.startY);
      if (horizontal<6 || horizontal<vertical) return;
      drag.active=true;
      canvas.setPointerCapture(event.pointerId);
      scene.setAttribute('data-scene-dragging', '');
    }
    const bounds=canvas.getBoundingClientRect();
    const turnX=dx/Math.max(bounds.width,1)*Math.PI*1.15;
    const turnY=drag.touch?0:dy/Math.max(bounds.height,1)*Math.PI*.95;
    yaw+=turnX; pitch+=turnY;
    const dt=Math.max((event.timeStamp-drag.at)/1000,.008);
    velocityX=moving()?Math.max(-4,Math.min(4,turnX/dt)):0;
    velocityY=moving()?Math.max(-4,Math.min(4,turnY/dt)):0;
    drag.x=event.clientX; drag.y=event.clientY; drag.at=event.timeStamp;
    draw();
  });
  function release(event) {
    if (!drag || event.pointerId!==drag.id) return;
    if (event.type!=='pointerup') velocityX=velocityY=0;
    else {
      const releaseDamping=Math.exp(-Math.max(0,event.timeStamp-drag.at)/140);
      velocityX*=releaseDamping; velocityY*=releaseDamping;
    }
    drag=null;
    scene.removeAttribute('data-scene-dragging');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    schedule();
  }
  for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas?.addEventListener(name, release);
  canvas?.addEventListener('webglcontextlost', event => { event.preventDefault(); fallback(); });
  canvas?.addEventListener('webglcontextrestored', initialise);
  new IntersectionObserver(([entry]) => { visible=entry.isIntersecting; sync(); }, { threshold:.1 }).observe(scene);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { drag=null; scene.removeAttribute('data-scene-dragging'); }
    sync();
  });
  reduced.addEventListener('change', sync);
  const resize = () => draw();
  if (typeof ResizeObserver==='function') new ResizeObserver(resize).observe(scene);
  else window.addEventListener('resize', resize, { passive:true });
  new MutationObserver(() => { if (renderer) { renderer.theme(); draw(); } }).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  sync(); initialise();
  scene.setAttribute('data-scene-ready', '');
}
