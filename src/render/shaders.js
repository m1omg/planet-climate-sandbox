export const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uSpin;        // planet rotation phase
uniform vec3  uSunDir;
uniform vec3  uStarColor;
uniform float uSeed;
uniform float uLandFrac;
uniform float uOceanFrac;
uniform float uWaterCap;    // 0 = bone dry, 1 = plenty of water for snow/sea
uniform float uCloud;       // mean cloud cover 0..1
uniform float uSteam;       // 0..1 thick steam envelope
uniform float uPTot;        // bar
uniform float uCO2;         // 0..1 how CO2-dominated the air is
uniform float uMagma;       // 0..1 molten surface
uniform float uLocked;      // 0 = free rotator, 1 = tidally locked
uniform float uNightGlow;   // thermal emission on the dark side
uniform float uBandT[18];
uniform float uBandIce[18];

const float PI = 3.14159265;

// ---------- hash / value noise ----------
float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*vnoise(p); n += a; p *= 2.03; a *= 0.5; }
  return s/n;
}
float ridged(vec3 p, int oct){
  float a=0.5,s=0.0,n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*(1.0-abs(vnoise(p)*2.0-1.0)); n+=a; p*=2.11; a*=0.5; }
  return s/n;
}

// ---------- band lookup ----------
float bandVal(float x, int which){
  float f = clamp((x+1.0)*0.5, 0.0, 0.99999) * 18.0 - 0.5;
  int i0 = int(floor(max(f,0.0)));
  int i1 = min(i0+1, 17);
  float t = clamp(f - float(i0), 0.0, 1.0);
  float a, b;
  if(which==0){ a = uBandT[i0];  b = uBandT[i1]; }
  else        { a = uBandIce[i0]; b = uBandIce[i1]; }
  return mix(a,b,t);
}

mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }

// ---------- surface colour ----------
vec3 surfaceColor(vec3 sp, float T, float ice, out float shininess, out float height){
  vec3 q = sp*2.2 + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3);
  float cont = fbm(q, 5);
  float detail = fbm(q*4.0, 4);
  // Sea level is set from the ocean coverage the simulation reports, which
  // already folds in both the land fraction and how much water actually exists.
  float landTarget = clamp(1.0 - uOceanFrac, 0.0, 1.0);
  float thr = 0.625 - 0.25*landTarget;
  float h = cont + 0.16*(detail - 0.5) - thr;
  height = h;
  float land = smoothstep(-0.010, 0.026, h);
  // A world with no ocean has no sea basins either -- the low ground is just
  // low ground, and must not be painted blue.
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));

  float mount = ridged(q*3.1, 4);
  vec3 rock   = mix(vec3(0.31,0.26,0.21), vec3(0.45,0.38,0.29), detail);
  vec3 desert = mix(vec3(0.70,0.52,0.29), vec3(0.85,0.69,0.42), detail);
  vec3 verdant= mix(vec3(0.16,0.34,0.15), vec3(0.33,0.47,0.20), detail);

  // vegetation only where it is temperate and there is water about
  float life = smoothstep(268.0,286.0,T)*(1.0-smoothstep(305.0,320.0,T))*smoothstep(0.15,0.6,uWaterCap);
  vec3 ground = mix(desert, verdant, life);
  ground = mix(ground, rock, smoothstep(0.10,0.26,h)*0.75 + mount*0.15);

  float deep = smoothstep(0.02,-0.20,h);
  vec3 sea = mix(vec3(0.09,0.34,0.56), vec3(0.01,0.06,0.20), deep);
  // shallow, drying seas turn briny and pale before they vanish altogether
  sea = mix(mix(desert, rock, 0.35), sea, smoothstep(0.02, 0.25, uWaterCap));

  vec3 col = mix(sea, ground, land);
  shininess = (1.0-land)*0.9;

  // ice: polar caps and sea ice, but only if the planet owns enough water
  float snowNoise = fbm(q*5.0, 3);
  float icy = clamp(ice*1.15 - 0.12*snowNoise, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  vec3 iceCol = mix(vec3(0.80,0.86,0.92), vec3(0.96,0.98,1.0), snowNoise);
  col = mix(col, iceCol, smoothstep(0.05,0.55,icy));
  shininess = mix(shininess, 0.45, smoothstep(0.05,0.55,icy));

  // molten
  float melt = smoothstep(1150.0,1500.0,T);
  vec3 lava = mix(vec3(0.55,0.08,0.02), vec3(1.0,0.55,0.12), pow(clamp(detail,0.0,1.0),1.5));
  col = mix(col, lava, melt);
  return col;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv*2.05, -1.6));

  vec3 col = vec3(0.0);

  // ---- starfield ----
  vec3 sdir = normalize(rd + vec3(0.0,0.0,0.0));
  float sf = hash(floor(sdir*260.0));
  float stars = pow(smoothstep(0.9975, 1.0, sf), 1.0);
  float tw = 0.7 + 0.3*sin(uTime*1.7 + sf*80.0);
  col += vec3(0.85,0.9,1.0)*stars*tw*1.4;
  col += vec3(0.02,0.03,0.06) * (0.6 + 0.4*fbm(sdir*2.0,3));

  // ---- sphere intersection ----
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b*b - c;

  // Thickness follows the actual surface pressure, and goes to nothing when
  // there is no air left: an airless rock must not wear a halo.
  float airAmount = smoothstep(0.0, 0.02, uPTot);
  float atmoThick = airAmount * clamp(0.030 + 0.10*log(1.0 + uPTot) + 0.16*uSteam, 0.0, 0.42);
  float Ra = 1.0 + atmoThick;
  float bA = dot(ro, rd), cA = dot(ro,ro) - Ra*Ra;
  float dA = bA*bA - cA;

  vec3 airTint = mix(vec3(0.35,0.60,1.0), vec3(1.0,0.72,0.34), uCO2);
  airTint = mix(airTint, vec3(1.0,0.96,0.92), uSteam);

  if(disc > 0.0){
    float t = -b - sqrt(disc);
    vec3 pos = ro + rd*t;
    vec3 n = normalize(pos);

    // planet-fixed coordinates
    vec3 sp = rotY(-uSpin) * n;
    // for a locked world the band axis runs from the substellar point
    float bandX = mix(n.y, dot(n, uSunDir), uLocked);
    float T = bandVal(bandX, 0);
    float ice = bandVal(bandX, 1);

    float shin, height;
    vec3 base = surfaceColor(sp, T, ice, shin, height);

    float ndl = dot(n, uSunDir);
    float lam = smoothstep(-0.12, 0.22, ndl);

    // specular glint off water and ice
    vec3 h = normalize(uSunDir - rd);
    float spec = pow(max(dot(n,h),0.0), 42.0) * shin * lam;

    vec3 lit = base * (0.06 + 0.94*lam) * uStarColor;
    lit += uStarColor * spec * 0.55;

    // thermal emission from a hot or molten surface: visible on the night side
    float glow = uNightGlow * (1.0 - lam);
    lit += vec3(1.0,0.30,0.08) * glow * (0.35 + 0.65*smoothstep(1100.0,1500.0,T));

    // ---- clouds ----
    vec3 cq = rotY(-uSpin*1.12) * n;
    float flow = uTime*0.012;
    float cl = fbm(cq*2.6 + vec3(flow, flow*0.3, -flow*0.6), 5);
    float bands = 0.5 + 0.5*sin(n.y*14.0 + fbm(cq*3.0,3)*5.0);
    cl = mix(cl, cl*0.6 + 0.4*bands, 0.45*(1.0-uLocked));
    // tidally locked worlds pile cloud over the substellar point
    float sub = smoothstep(0.0, 0.9, dot(n, uSunDir));
    float cover = clamp(uCloud + uLocked*sub*0.35, 0.0, 1.0);
    float cmask = smoothstep(1.0-cover, 1.0-cover+0.30, cl);
    cmask = max(cmask, uSteam);
    vec3 cloudCol = mix(vec3(1.0,0.99,0.97), vec3(0.98,0.86,0.72), uCO2*0.5);
    lit = mix(lit, cloudCol * uStarColor * (0.10 + 0.90*lam), cmask*0.80);

    // limb darkening + atmospheric rim seen against the surface
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    lit += airTint * fres * lam * (0.30 + 1.0*atmoThick) * 0.75 * airAmount;

    col = lit;
  } else if(dA > 0.0){
    // ---- atmospheric halo outside the disc ----
    float t0 = -bA - sqrt(dA), t1 = -bA + sqrt(dA);
    float path = max(t1 - t0, 0.0);
    vec3 mid = ro + rd*(t0 + path*0.5);
    float lam = smoothstep(-0.35, 0.5, dot(normalize(mid), uSunDir));
    float dens = pow(clamp(path / (2.0*atmoThick + 0.001), 0.0, 1.0), 1.7);
    col += airTint * dens * lam * (0.55 + 1.3*uSteam) * 0.9 * airAmount;
  }

  // ---- the star itself ----
  vec3 sunDirScreen = normalize(uSunDir);
  float sd = max(dot(normalize(rd), sunDirScreen), 0.0);
  col += uStarColor * pow(sd, 900.0) * 3.0;
  col += uStarColor * pow(sd, 24.0) * 0.05;

  // tonemap
  col = col / (col + vec3(0.85));
  col = pow(col, vec3(1.0/2.2));
  fragColor = vec4(col, 1.0);
}`;
