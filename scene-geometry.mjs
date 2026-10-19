const TAU = Math.PI * 2;
export const RIBBON_FILAMENTS = 64;
const normalise = v => { const length = Math.hypot(...v); return v.map(n => n / length); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

function ribbonFrame(t) {
  const centre = [1.42*Math.cos(t), -.56*Math.sin(2*t), .34*Math.sin(t)];
  const tangent = [-1.42*Math.sin(t), -1.12*Math.cos(2*t), .34*Math.cos(t)];
  // Preserve the widening and gathering of the original offset SVG strands.
  const spread = [Math.cos(t), -.7*Math.sin(2*t)-.58, .15*Math.cos(t)];
  const normal = normalise(cross(tangent,spread));
  return { centre,spread,normal,lateral:normalise(cross(normal,tangent)) };
}
function pointOnFrame(frame, around) {
  const wide=Math.cos(around)*.155, thin=Math.sin(around)*.018;
  return frame.centre.map((n,i)=>n+frame.spread[i]*wide+frame.normal[i]*thin);
}
export function ribbonPoint(t, around) { return pointOnFrame(ribbonFrame(t),around); }

// Both currents share one phase; they meet behind the clasp whenever it reaches one half.
export function flowPhase(time) {
  if (!Number.isFinite(time)) throw new RangeError('Scene clock must be finite');
  return ((time*.15)%1+1)%1;
}
export function signalHeads(flow) {
  if (!Number.isFinite(flow)) throw new RangeError('Flow phase must be finite');
  const heads=[];
  for (const direction of [1,-1]) for (const head of [0,1]) {
    const lane=direction>0?16:48, phase=(((direction>0?flow:1-flow)+head)/2%1+1)%1;
    heads.push({ point:ribbonPoint(phase*TAU,lane/RIBBON_FILAMENTS*TAU), phase, lane, direction });
  }
  return heads;
}

// Slow camera breathing; both cycles close at the shared 100-second clock wrap.
export function ambientRotation(time) {
  if (!Number.isFinite(time)) throw new RangeError('Scene clock must be finite');
  return [.14*Math.sin(time*TAU/25),.045*Math.sin(time*TAU/20)];
}

export function rotatePoint([x, y, z], yaw, pitch) {
  const roll = .22;
  const a = x*Math.cos(roll)-y*Math.sin(roll);
  const b = x*Math.sin(roll)+y*Math.cos(roll);
  const c = a*Math.sin(yaw)+z*Math.cos(yaw);
  return [a*Math.cos(yaw)-z*Math.sin(yaw), b*Math.cos(pitch)-c*Math.sin(pitch), b*Math.sin(pitch)+c*Math.cos(pitch)];
}

export function createRibbonGeometry(segments=192, filaments=RIBBON_FILAMENTS) {
  if (!Number.isInteger(segments) || segments<16 || segments>384 || !Number.isInteger(filaments) || filaments<8 || filaments>72) throw new RangeError('Ribbon resolution is outside the supported range');
  const frames=Array.from({length:segments+1},(_,i)=>ribbonFrame(i/segments*TAU));
  function vertex(step,lane,count) {
    const angle=lane/count*TAU, frame=frames[step];
    const normal=normalise(frame.lateral.map((n,i)=>n*Math.cos(angle)/.155+frame.normal[i]*Math.sin(angle)/.018));
    return [...pointOnFrame(frame,angle),step/segments,lane/count*RIBBON_FILAMENTS,...normal];
  }
  const grid=frames.map((_,step)=>Array.from({length:filaments},(_,lane)=>vertex(step,lane,filaments)));
  const lines=[];
  for(let lane=0;lane<filaments;lane++) for(let step=0;step<segments;step++) lines.push(...grid[step][lane],...grid[step+1][lane]);
  const surface=[], sides=32;
  for(let step=0;step<segments;step++) for(let side=0;side<sides;side++) {
    const a=vertex(step,side,sides),b=vertex(step+1,side,sides),c=vertex(step+1,side+1,sides),d=vertex(step,side+1,sides);
    surface.push(...a,...b,...c,...a,...c,...d);
  }
  return {lines:new Float32Array(lines),surface:new Float32Array(surface)};
}
