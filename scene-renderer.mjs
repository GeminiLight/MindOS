import { createCoreGeometry } from './scene-core.mjs';
import { createRibbonGeometry, flowPhase, ribbonPoint, rotatePoint, signalHeads } from './scene-geometry.mjs';

const vertex = `
attribute vec3 a_position;
attribute vec2 a_signal;
attribute vec3 a_normal;
uniform vec2 u_rotation;
uniform vec2 u_size;
uniform float u_scale;
uniform float u_ratio;
uniform mediump float u_time;
uniform mediump float u_core;
uniform mediump float u_flow;
varying vec2 v_signal;
varying float v_depth;
varying vec3 v_normal;
varying vec3 v_local;
varying vec3 v_tangent;
vec3 turn(vec3 p) {
  float cr=cos(.22),sr=sin(.22),cy=cos(u_rotation.x),sy=sin(u_rotation.x),cp=cos(u_rotation.y),sp=sin(u_rotation.y);
  p.xy=vec2(p.x*cr-p.y*sr,p.x*sr+p.y*cr);
  p.xz=vec2(p.x*cy-p.z*sy,p.x*sy+p.z*cy);
  p.yz=vec2(p.y*cp-p.z*sp,p.y*sp+p.z*cp);
  return p;
}
void main() {
  vec3 local=a_position,normal=a_normal;
  if(u_core>.5 && a_signal.y>2.5) {
    // Rings leave the clasp as the opposing currents meet behind it.
    float progress=fract(u_flow+.5-(a_signal.y-3.0)*.14);
    local.xy*=1.0+(1.0-(1.0-progress)*(1.0-progress))*.6;
  }
  if(u_core>.5 && a_signal.y>1.5 && a_signal.y<2.5) {
    float angle=-.22+sin(u_time*.314159265)*.09;
    mat2 spin=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));
    local.xy=spin*local.xy; normal.xy=spin*normal.xy;
  }
  vec3 p=turn(local);
  gl_Position=vec4(p.x*u_scale/(u_size.x/u_size.y),p.y*u_scale,-p.z*.1,1.0-p.z/8.0);
  gl_PointSize=5.4*u_ratio;
  v_signal=a_signal; v_depth=p.z; v_normal=turn(normal); v_local=local; v_tangent=turn(vec3(-local.y,local.x,0.0));
}`;
const fragment = `
precision mediump float;
uniform vec3 u_ink;
uniform vec3 u_light;
uniform vec3 u_shine;
uniform vec3 u_paper;
uniform vec3 u_pearl;
uniform mediump float u_time;
uniform mediump float u_core;
uniform float u_surface;
uniform float u_points;
uniform mediump float u_flow;
varying vec2 v_signal;
varying float v_depth;
varying vec3 v_normal;
varying vec3 v_local;
varying vec3 v_tangent;
void main() {
  vec3 n=normalize(v_normal);
  float diffuse=.42+.58*abs(dot(n,normalize(vec3(-.4,.6,1.0))));
  float sheen=pow(abs(dot(n,normalize(vec3(-.65,.5,1.0)))),24.0);
  float direction=v_signal.y<32.0?1.0:-1.0;
  // A soft-headed comet with a long silk tail, spread across neighbouring strands.
  float trail=fract(u_flow-direction*2.0*v_signal.x+.5)-.5;
  float lane=(mod(v_signal.y,32.0)-16.0)/2.6;
  float lead=min(trail,0.0)*42.0;
  float signal=exp(-max(trail,0.0)*7.0-lead*lead-lane*lane);
  float weave=.35+.65*pow(abs(sin(v_signal.y/64.0*6.283185)),.6);
  float depth=clamp(.76+v_depth*.16,.45,1.0);
  float wave=.5+.5*sin(v_signal.x*6.283185-u_time*.314159265);
  vec3 color=mix(u_ink,u_shine,sheen*.65);
  color=mix(color,u_light,signal*.8);
  float alpha=(.18+.37*weave)*diffuse*depth+signal*.40;
  if(u_surface>.5) {
    float footprint=STRAND_FOOTPRINT;
    float distance=abs(fract(v_signal.y+.5)-.5);
    float strand=1.0-smoothstep(.13-footprint*.5,.13+footprint*.5,distance);
    strand=mix(strand,.26,smoothstep(.3,.95,footprint));
    // Broad light models the folded silk; a narrow highlight catches individual threads.
    // Keep the unlit side legible in both themes instead of washing the whole ribbon out.
    vec3 face=n*(n.z<0.0?-1.0:1.0);
    float key=max(dot(face,normalize(vec3(-.55,.8,.65))),0.0);
    float rim=pow(1.0-abs(face.z),2.5);
    float satin=pow(max(dot(face,normalize(vec3(-.3,.6,1.0))),0.0),12.0);
    alpha=(.19+.13*key+strand*.72*weave+rim*.12)*depth+signal*(.12+.32*strand);
    float dark=1.0-step(.5,dot(u_paper,vec3(.299,.587,.114)));
    alpha=min(alpha*(1.0+dark*.24),.96);
    color=mix(u_light,u_ink,.35+.65*key);
    color=mix(color,u_shine,satin*.42+rim*.12+wave*.025);
    color=mix(color,u_light,signal*(.4+.55*strand));
  }
  if(u_points>.5) { color=mix(u_light,u_pearl,.24); alpha=(1.0-smoothstep(.1,1.0,length(gl_PointCoord-.5)*2.0))*.9; }
  if(u_core>.5) {
    // One key light, Blinn highlight and a Fresnel rim shared by every clasp material.
    float order=step(dot(u_ink,vec3(.299,.587,.114)),dot(u_light,vec3(.299,.587,.114)));
    vec3 deep=mix(u_light,u_ink,order),bright=mix(u_ink,u_light,order);
    vec3 f=n*(n.z<0.0?-1.0:1.0),key=normalize(vec3(-.45,.65,1.0)),halfway=normalize(key+vec3(0.0,0.0,1.0));
    float facing=max(dot(f,key),0.0),lighting=.35+.65*facing;
    float specular=pow(max(dot(f,halfway),0.0),48.0),fresnel=pow(1.0-abs(f.z),3.0);
    float beat=fract(u_flow+.5),near=(beat<.5?beat:beat-1.0)*7.0,meet=exp(-near*near);
    float across=((v_local.x+v_local.y)*.707-mix(-.3,.3,smoothstep(0.0,.24,beat)))*22.0;
    float glint=exp(-across*across)*sin(3.14159265*clamp(beat/.24,0.0,1.0));
    vec3 tangent=v_tangent/max(length(v_tangent),.0001);
    float th=dot(tangent,halfway),brushed=pow(max(1.0-th*th,0.0),36.0)*smoothstep(.015,.06,length(v_local.xy));
    color=mix(u_paper,deep,(1.0-lighting)*.16);
    color=mix(color,u_pearl,brushed*.1+glint*.05);
    color=mix(color,bright,fresnel*.25); alpha=1.0;
    if(v_signal.y>.5) {
      color=mix(mix(deep,bright,lighting),u_paper,.18);
      color=mix(color,u_pearl,specular*.6+glint*.3+meet*.16);
      color=mix(color,bright,fresnel*.3);
    }
    if(v_signal.y>1.5) {
      color=mix(deep,bright,clamp((facing-.5)*2.0,0.0,1.0));
      color=mix(color,u_pearl,specular*.5+glint*.45+meet*.1);
      color=mix(color,bright,fresnel*.2);
    }
    if(v_signal.y>2.5) {
      float progress=fract(beat-(v_signal.y-3.0)*.14);
      color=mix(u_ink,bright,.4); alpha=smoothstep(0.0,.05,progress)*(1.0-progress)*(1.0-progress)*.26;
    }
  }
  gl_FragColor=vec4(color*alpha,alpha);
}`;

export function createSceneRenderer(canvas, scene) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL unavailable');
  const resources = [];
  const dispose = () => { for (const [kind, object] of resources) gl[kind](object); };
  function shader(type, source) {
    const object = gl.createShader(type);
    if (!object) throw new Error('Shader allocation failed');
    resources.push(['deleteShader', object]);
    gl.shaderSource(object, source); gl.compileShader(object);
    if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
    return object;
  }
  try {
    const program = gl.createProgram();
    if (!program) throw new Error('Program allocation failed');
    resources.push(['deleteProgram', program]);
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
    const derivatives=Boolean(gl.getExtension('OES_standard_derivatives'));
    const material=(derivatives?'#extension GL_OES_standard_derivatives : enable\n':'')+fragment.replace('STRAND_FOOTPRINT',derivatives?'max(fwidth(v_signal.y),.015)':'.3');
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER,material));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program link failed');
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'a_position');
    const signal = gl.getAttribLocation(program, 'a_signal');
    const normal = gl.getAttribLocation(program, 'a_normal');
    const uniforms = Object.fromEntries(['rotation','size','scale','ink','light','shine','paper','pearl','time','surface','points','ratio','core','flow'].map(name => [name, gl.getUniformLocation(program, 'u_'+name)]));
    const geometry = createRibbonGeometry(), coreGeometry=createCoreGeometry();
    function buffer(data) {
      const object = gl.createBuffer();
      if (!object) throw new Error('Buffer allocation failed');
      resources.push(['deleteBuffer', object]);
      gl.bindBuffer(gl.ARRAY_BUFFER, object); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return object;
    }
    const lines = buffer(geometry.lines), surface = buffer(geometry.surface), coreBuffer=buffer(coreGeometry);
    const heads = new Float32Array(4*8), headBuffer = buffer(heads);
    function readColor(variable) {
      const probe = document.createElement('span');
      probe.style.color = 'var('+variable+')'; scene.append(probe);
      const values = getComputedStyle(probe).color.match(/[\d.]+/g);
      probe.remove();
      return values.slice(0, 3).map(n => Number(n)/255);
    }
    function theme() {
      gl.useProgram(program);
      gl.uniform3fv(uniforms.ink, readColor('--hero-filament'));
      gl.uniform3fv(uniforms.light, readColor('--hero-core'));
      gl.uniform3fv(uniforms.paper,readColor('--hero-background'));
      const background=readColor('--hero-background');
      gl.uniform3fv(uniforms.pearl,readColor(background[0]>.5?'--popover':'--foreground'));
      gl.uniform3fv(uniforms.shine,background[0]>.5?background:readColor('--hero-core'));
    }
    let fitKey = [], scale = .96;
    function draw(yaw, pitch, time, fitYaw=yaw, fitPitch=pitch) {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height || gl.isContextLost()) return;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.rotation, yaw, pitch);
      gl.uniform2f(uniforms.size, width, height);
      // Fit every orientation, including a side-on view, without clipping the strands.
      if (fitKey[0]!==fitYaw || fitKey[1]!==fitPitch || fitKey[2]!==width || fitKey[3]!==height) {
        let extent = 0;
        for (let i = 0; i < 48; i++) for (const side of [0, Math.PI]) {
          const p = rotatePoint(ribbonPoint(i/48*Math.PI*2, side), fitYaw, fitPitch);
          const perspective = 1-p[2]/8;
          extent = Math.max(extent, Math.abs(p[0])/(width/height)/perspective, Math.abs(p[1])/perspective);
        }
        scale=Math.min(.96,.82/extent); fitKey=[fitYaw,fitPitch,width,height];
      }
      gl.uniform1f(uniforms.scale,scale);
      // Keep phase values small before passing them to mediump shaders.
      const flow=flowPhase(time);
      gl.uniform1f(uniforms.time, time); gl.uniform1f(uniforms.flow, flow);
      gl.uniform1f(uniforms.core,0);
      gl.uniform1f(uniforms.points, 0); gl.uniform1f(uniforms.ratio, ratio);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.enableVertexAttribArray(position);
      gl.bindBuffer(gl.ARRAY_BUFFER, surface);
      gl.vertexAttribPointer(position,3,gl.FLOAT,false,32,0);
      gl.enableVertexAttribArray(signal); gl.vertexAttribPointer(signal,2,gl.FLOAT,false,32,12);
      gl.enableVertexAttribArray(normal); gl.vertexAttribPointer(normal,3,gl.FLOAT,false,32,20);
      gl.uniform1f(uniforms.surface, 1);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1,1);
      // Resolve the nearest surface first so translucent back strands do not form a mesh.
      gl.colorMask(false,false,false,false);
      gl.drawArrays(gl.TRIANGLES,0,geometry.surface.length/8);
      gl.colorMask(true,true,true,true);
      gl.drawArrays(gl.TRIANGLES,0,geometry.surface.length/8);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindBuffer(gl.ARRAY_BUFFER, lines);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(signal); gl.vertexAttribPointer(signal, 2, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(normal,3,gl.FLOAT,false,32,20);
      gl.uniform1f(uniforms.surface, 0);
      if (!derivatives) gl.drawArrays(gl.LINES,0,geometry.lines.length/8);
      signalHeads(flow).forEach((head,i)=>heads.set([...head.point,head.phase,head.lane,0,0,1],i*8));
      gl.bindBuffer(gl.ARRAY_BUFFER,headBuffer); gl.bufferData(gl.ARRAY_BUFFER,heads,gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(position,3,gl.FLOAT,false,32,0);
      gl.vertexAttribPointer(signal,2,gl.FLOAT,false,32,12);
      gl.vertexAttribPointer(normal,3,gl.FLOAT,false,32,20);
      gl.uniform1f(uniforms.points,1); gl.drawArrays(gl.POINTS,0,4);
      gl.uniform1f(uniforms.points,0); gl.uniform1f(uniforms.core,1);
      gl.bindBuffer(gl.ARRAY_BUFFER,coreBuffer);
      gl.vertexAttribPointer(position,3,gl.FLOAT,false,32,0);
      gl.vertexAttribPointer(signal,2,gl.FLOAT,false,32,12);
      gl.vertexAttribPointer(normal,3,gl.FLOAT,false,32,20);
      gl.drawArrays(gl.TRIANGLES,0,coreGeometry.length/8);
    }
    theme();
    return { draw, theme, dispose };
  } catch (error) { dispose(); throw error; }
}
