// Shared vertex layout: position, surface coordinates/material, outward normal.
export function createCoreGeometry(segments=96) {
  if(!Number.isInteger(segments)||segments<32||segments>192)throw new RangeError('Core resolution is outside the supported range');
  const result=[],tau=Math.PI*2,centre=.375;
  const circle=(radius,z,t)=>[radius*Math.cos(t),radius*Math.sin(t),z];
  const star=(radius,z,t)=>[radius*Math.cos(t)**3,radius*Math.sin(t)**3,z];
  function triangle(a,b,c,material,phases=[0,0,0]) {
    const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...normal);
    if(length<1e-12)return;
    for(const [i,p] of [a,b,c].entries())result.push(...p,phases[i],material,...normal.map(n=>n/length));
  }
  function band(shape,r1,z1,r2,z2,material) {
    for(let i=0;i<segments;i++){
      const t=i/segments*tau,next=(i+1)/segments*tau;
      const a=shape(r1,z1,t),b=shape(r2,z2,t),c=shape(r2,z2,next),d=shape(r1,z1,next);
      triangle(a,b,c,material,[i/segments,i/segments,(i+1)/segments]);
      triangle(a,c,d,material,[i/segments,(i+1)/segments,(i+1)/segments]);
    }
  }
  // A thin, two-faced clasp: a fine inner bead, raised paper lip, soft chamfer and narrow rim keep it from reading as a coin.
  for(const side of [1,-1]){
    const face=centre+side*.012;
    for(let i=0;i<segments;i++){
      const a=circle(.168,face,i/segments*tau),b=circle(.168,face,(i+1)/segments*tau);
      triangle([0,0,face],...(side>0?[a,b]:[b,a]),0);
    }
    band(circle,.168,face,.1705,face+side*.003,1);
    band(circle,.1705,face+side*.003,.179,face+side*.003,0);
    band(circle,.179,face+side*.003,.1835,face,0);
    band(circle,.1835,face,.187,centre+side*.006,1);
    // The raised star: a steep fine wall, then a shallow faceted crown that catches the light.
    band(star,.118,face,.109,face+side*.008,2);
    for(let i=0;i<segments;i++){
      const a=star(.109,face+side*.008,i/segments*tau),b=star(.109,face+side*.008,(i+1)/segments*tau);
      triangle([0,0,face+side*.032],...(side>0?[a,b]:[b,a]),2);
    }
  }
  band(circle,.187,centre-.006,.187,centre+.006,1);
  // Two translucent rings share the same 3D plane and expand in the vertex shader.
  band(circle,.213,centre+.003,.215,centre+.003,3);
  band(circle,.213,centre+.003,.215,centre+.003,4);
  return new Float32Array(result);
}
