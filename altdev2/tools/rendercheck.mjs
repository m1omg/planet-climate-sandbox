// A CPU port of the planet fragment shader, faithful enough to reproduce what
// the GPU draws. Exists because this machine has no WebGL2 context to render
// into, and "looks right" is otherwise unverifiable. Writes a PPM.
import { writeFileSync } from 'node:fs';

const V = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const nrm = (a) => { const L = Math.hypot(...a) || 1; return [a[0]/L, a[1]/L, a[2]/L]; };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const clamp = (v,a,b) => v<a?a:v>b?b:v;
const mix = (a,b,t) => a+(b-a)*t;
const mixv = (a,b,t) => [mix(a[0],b[0],t), mix(a[1],b[1],t), mix(a[2],b[2],t)];
const fract = (x) => x - Math.floor(x);
function smoothstep(e0,e1,x){ const t=clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); }

function hash3(p){
  const a=[dot(p,[127.1,311.7,74.7]), dot(p,[269.5,183.3,246.1]), dot(p,[113.5,271.9,124.6])];
  return a.map(v => -1 + 2*fract(Math.sin(v)*43758.5453123));
}
function gnoise(x){
  const i=[Math.floor(x[0]),Math.floor(x[1]),Math.floor(x[2])];
  const f=[x[0]-i[0], x[1]-i[1], x[2]-i[2]];
  const u=f.map(t=>t*t*t*(t*(t*6-15)+10));
  const g=(dx,dy,dz)=>dot(hash3([i[0]+dx,i[1]+dy,i[2]+dz]),[f[0]-dx,f[1]-dy,f[2]-dz]);
  const m=(a,b,t)=>a+(b-a)*t;
  return m(m(m(g(0,0,0),g(1,0,0),u[0]), m(g(0,1,0),g(1,1,0),u[0]), u[1]),
           m(m(g(0,0,1),g(1,0,1),u[0]), m(g(0,1,1),g(1,1,1),u[0]), u[1]), u[2])*0.5+0.5;
}
const ROT=[[0,0.80,0.60],[-0.80,0.36,-0.48],[-0.60,-0.48,0.64]];
const rotm=(p)=>[dot(ROT[0],p),dot(ROT[1],p),dot(ROT[2],p)];   // column-major like GLSL mat3*vec
function fbm(p,oct){ let a=0.5,s=0,n=0,q=p.slice();
  for(let i=0;i<oct;i++){ s+=a*gnoise(q); n+=a; q=mul(rotm(q),2.02); a*=0.5; } return s/n; }
function ridged(p,oct){ let a=0.5,s=0,n=0,prev=1,q=p.slice();
  for(let i=0;i<oct;i++){ let r=1-Math.abs(gnoise(q)*2-1); r*=r; s+=a*r*prev; prev=r; n+=a; q=mul(rotm(q),2.11); a*=0.5; } return s/n; }
function warpedFbm(p,oct){
  const q=[fbm(p,4), fbm(add(p,[5.2,1.3,2.7]),4), fbm(add(p,[1.7,9.2,3.1]),4)];
  return fbm(add(p, mul(sub(q,[0.5,0.5,0.5]),2.4)), oct);
}
function rotY(a){ const c=Math.cos(a),s=Math.sin(a); return (v)=>[c*v[0]+s*v[2], v[1], -s*v[0]+c*v[2]]; }

// The time-invariant surface fields, evaluated exactly as the bake shader does.
export const HEIGHT_QUANTUM = 1/65535;
export function fieldsAt(sp, seed){
  const q=add(mul(sp,2.2),[seed*13.7,seed*7.1,seed*3.3]);
  const cont=warpedFbm(q,6), detail=fbm(mul(q,5),5), fine=fbm(mul(q,17),3);
  return { cont, detail, fine, mount: ridged(mul(q,3.4),5), floe: fbm(mul(q,9),4),
           h: cont + 0.10*(detail-0.5) + 0.03*(fine-0.5) };
}

export function render(opts={}) {
  const W=opts.W??220, H=opts.H??165;
  const U={ seed:12.3, landFrac:0.3, oceanFrac:0.70, waterCap:1, cloud:0.51, steam:0, pTot:0.80,
            co2:3.5e-4, locked:0, nightGlow:0, glaciated:1, spin:0, yaw:0, pitch:0,
            starColor:[1,0.738,0.658], sun:nrm([0.62,0.28,0.73]), T:288, ice:0.04, ...opts };
  const px=[];
  let peak={v:-1};
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const uvx=((x+0.5)-0.5*W)/Math.min(W,H), uvy=(0.5*H-(y+0.5))/Math.min(W,H);
      const ro=[0,0,3];
      const rd=nrm([uvx*2.05, uvy*2.05, -1.6]);
      let col=[0,0,0];
      const b=dot(ro,rd), c=dot(ro,ro)-1, disc=b*b-c;
      const airAmount=smoothstep(0,0.02,U.pTot);
      const atmoThick=airAmount*clamp(0.030+0.10*Math.log(1+U.pTot)+0.16*U.steam,0,0.42);
      const airTint=mixv(mixv([0.35,0.60,1.0],[1.0,0.72,0.34],U.co2),[1.0,0.96,0.92],U.steam);
      if(disc>0){
        const t=-b-Math.sqrt(disc);
        const pos=add(ro,mul(rd,t)), n=nrm(pos);
        const sp=rotY(-U.spin)(n);
        const q=add(mul(sp,2.2),[U.seed*13.7,U.seed*7.1,U.seed*3.3]);
        const cont=warpedFbm(q,6), detail=fbm(mul(q,5),5), fine=fbm(mul(q,17),3);
        const landTarget=clamp(1-U.oceanFrac,0,1);
        const thr=0.625-0.25*landTarget;
        const h=cont+0.10*(detail-0.5)+0.03*(fine-0.5)-thr;
        let land=smoothstep(-0.010,0.026,h);
        land=mix(1,land,smoothstep(0,0.04,U.oceanFrac));
        const mount=ridged(mul(q,3.4),5)*smoothstep(0,0.16,h);
        const elev=Math.max(h,0)+0.30*mount;
        const sand=mixv([0.68,0.50,0.28],[0.86,0.71,0.45],detail);
        const rock=mixv([0.30,0.25,0.21],[0.46,0.39,0.31],detail);
        const forest=mixv([0.11,0.26,0.11],[0.24,0.40,0.16],detail);
        const steppe=mixv([0.42,0.44,0.22],[0.56,0.54,0.30],detail);
        const warmth=smoothstep(266,284,U.T)*(1-smoothstep(303,322,U.T));
        const life=warmth*smoothstep(0.10,0.55,U.waterCap)*(1-smoothstep(0.10,0.30,elev));
        let ground=mixv(mixv(sand,mixv([0.78,0.62,0.38],[0.90,0.79,0.56],fine),smoothstep(0.05,0.22,elev)),
                        mixv(steppe,forest,smoothstep(0.25,0.75,life)), smoothstep(0.12,0.50,life));
        ground=mixv(ground, mixv(rock,mixv([0.42,0.38,0.34],[0.58,0.53,0.47],fine),mount), smoothstep(0.12,0.34,elev));
        const depth=smoothstep(0,-0.26,h);
        let sea=mixv(mixv([0.16,0.48,0.60],[0.06,0.26,0.47],smoothstep(0,0.35,depth)),[0.010,0.055,0.17],smoothstep(0.35,1,depth));
        sea=mixv(mixv(sand,rock,0.35),sea,smoothstep(0.02,0.25,U.waterCap));
        let base=mixv(sea,ground,land);
        let shin=(1-land)*0.9;
        const floe=fbm(mul(q,9),4);
        const snowline=smoothstep(-0.06,0.22,elev);
        const seaIceAmt=clamp(U.ice*1.05-0.16*floe,0,1)*mix(0.25,1,U.waterCap);
        const seaIceMask=smoothstep(0.06,0.52,seaIceAmt)*(1-land);
        const sheetAmt=clamp(U.ice*(0.70+0.60*snowline)-0.18*floe,0,1)*U.glaciated;
        const sheetMask=smoothstep(0.06,0.52,sheetAmt)*land;
        base=mixv(base,mixv([0.72,0.82,0.90],[0.90,0.95,0.99],floe),seaIceMask);
        base=mixv(base,mixv([0.86,0.90,0.94],[0.99,1.00,1.00],fine),sheetMask);
        shin=mix(shin,0.18,Math.max(seaIceMask,sheetMask));

        const ndl=dot(n,U.sun), lam=smoothstep(-0.12,0.22,ndl);
        const hv=nrm(sub(U.sun,rd));
        const grazing=Math.pow(1-Math.max(dot(n,mul(rd,-1)),0),2.5);
        const spec=Math.pow(Math.max(dot(n,hv),0),260)*shin*lam*(0.10+0.90*grazing);
        let lit=mul([base[0]*U.starColor[0],base[1]*U.starColor[1],base[2]*U.starColor[2]],(0.06+0.94*lam));
        lit=add(lit,mul(U.starColor,spec*0.30));
        const fres=Math.pow(1-Math.max(dot(n,mul(rd,-1)),0),3);
        lit=add(lit,mul(airTint,fres*lam*(0.30+1.0*atmoThick)*0.75*airAmount));
        col=lit;
        if(spec*0.30>peak.v) peak={v:spec*0.30,x,y,what:'specular',n};
      }
      const tone=(v)=>Math.pow(v/(v+0.85),1/2.2);
      px.push(col.map(tone));
    }
  }
  return {W,H,px,peak};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = render({});
  const buf = Buffer.alloc(r.W*r.H*3);
  r.px.forEach((c,i)=>{ buf[i*3]=clamp(c[0]*255,0,255); buf[i*3+1]=clamp(c[1]*255,0,255); buf[i*3+2]=clamp(c[2]*255,0,255); });
  writeFileSync('/tmp/planet.ppm', Buffer.concat([Buffer.from(`P6\n${r.W} ${r.H}\n255\n`), buf]));
  // brightest pixel and where
  let bi=0,bv=-1;
  r.px.forEach((c,i)=>{const v=c[0]+c[1]+c[2]; if(v>bv){bv=v;bi=i;}});
  console.log('brightest pixel at', bi%r.W, Math.floor(bi/r.W), 'value', r.px[bi].map(v=>v.toFixed(2)).join(','));
  console.log('peak specular contribution', r.peak.v.toExponential(2), 'at', r.peak.x, r.peak.y);
  console.log('wrote /tmp/planet.ppm');
}
