// ---------- gradient noise ----------
// Value noise is cheap but visibly blobby. Gradient (Perlin-style) noise gives
// terrain with real ridges and valleys instead of soft lumps.
float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec3 hash3(vec3 p){
  p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}
float gnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);   // quintic fade: smooth second derivative
  return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)),
                     dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),
                     dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),
                     dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),
                     dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
}
float vnoise(vec3 x){ return gnoise(x); }

// Fixed octave counts, one function each.
//
// These used to be a single loop with a constant bound of 8 and the unwanted
// octaves multiplied by zero -- "a few wasted octaves, which is free, this runs
// during the one-off bake". It was not free: it was 1.84x the work, and the
// bake is the most expensive thing this program does. A literal loop bound also
// keeps GLSL ES 1.00 happy, which is why the zero-weight trick existed.
//
// The zeroed terms contributed nothing to either the sum or its normaliser, so
// these are bit-for-bit what the old code produced.
mat3 octaveRot(){ return mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64); }

float fbm3(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0; mat3 R = octaveRot();
  for(int i=0;i<3;i++){ s += a*gnoise(p); n += a; p = R*p*2.02; a *= 0.5; }
  return s/max(n, 1e-6);
}
float fbm4(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0; mat3 R = octaveRot();
  for(int i=0;i<4;i++){ s += a*gnoise(p); n += a; p = R*p*2.02; a *= 0.5; }
  return s/max(n, 1e-6);
}
float fbm5(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0; mat3 R = octaveRot();
  for(int i=0;i<5;i++){ s += a*gnoise(p); n += a; p = R*p*2.02; a *= 0.5; }
  return s/max(n, 1e-6);
}
float fbm6(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0; mat3 R = octaveRot();
  for(int i=0;i<6;i++){ s += a*gnoise(p); n += a; p = R*p*2.02; a *= 0.5; }
  return s/max(n, 1e-6);
}
// Ridged multifractal: mountain chains rather than blobs.
float ridged4(vec3 p){
  float a=0.5, s=0.0, n=0.0, prev=1.0; mat3 R = octaveRot();
  for(int i=0;i<4;i++){
    float r = 1.0-abs(gnoise(p)*2.0-1.0); r *= r;
    s += a*r*prev; prev = r; n += a; p = R*p*2.11; a *= 0.5;
  }
  return s/max(n, 1e-6);
}
float ridged5(vec3 p){
  float a=0.5, s=0.0, n=0.0, prev=1.0; mat3 R = octaveRot();
  for(int i=0;i<5;i++){
    float r = 1.0-abs(gnoise(p)*2.0-1.0); r *= r;
    s += a*r*prev; prev = r; n += a; p = R*p*2.11; a *= 0.5;
  }
  return s/max(n, 1e-6);
}
// Continents: fbm whose input is displaced by more fbm, giving coastlines with
// bays, peninsulas and inland seas instead of round islands.
float warpedFbm6(vec3 p){
  vec3 q = vec3(fbm4(p), fbm4(p + vec3(5.2,1.3,2.7)), fbm4(p + vec3(1.7,9.2,3.1)));
  return fbm6(p + 2.4*(q - 0.5));
}
