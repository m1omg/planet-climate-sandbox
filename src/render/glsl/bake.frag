#version 300 es
precision highp float;

// Bakes the planet's time-invariant surface fields into a cube map face.
//
// Every noise evaluation in the runtime shader depended only on position on the
// sphere and on the seed -- climate changes the colouring, never the terrain --
// so all of it can be computed once here and sampled thereafter. That is the
// difference between 269 noise evaluations per pixel per frame and two texture
// fetches.
//
// A cube map rather than an equirectangular map because the fields are defined
// on directions in space: no pole pinching, no wrap seam, uniform resolution.

uniform vec2  uSize;      // face resolution in texels
uniform float uSeed;
uniform int   uFace;      // 0..5, in GL cube-map face order

//__NOISE__

layout(location = 0) out vec4 oTerrain;   // R,G = height (16-bit), B = detail, A = fine
layout(location = 1) out vec4 oDetail;    // R = mount, G = floe, B,A = normal.xy

// Direction for a texel on a cube-map face, in GL's face order and orientation.
vec3 faceDir(int face, vec2 uv){
  vec2 t = uv * 2.0 - 1.0;
  if(face == 0) return normalize(vec3( 1.0, -t.y, -t.x));   // +X
  if(face == 1) return normalize(vec3(-1.0, -t.y,  t.x));   // -X
  if(face == 2) return normalize(vec3( t.x,  1.0,  t.y));   // +Y
  if(face == 3) return normalize(vec3( t.x, -1.0, -t.y));   // -Y
  if(face == 4) return normalize(vec3( t.x, -t.y,  1.0));   // +Z
  return              normalize(vec3(-t.x, -t.y, -1.0));    // -Z
}

vec3 fieldPoint(vec3 sp){ return sp*2.2 + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3); }

// The same combination the runtime shader used to compute inline.
float heightAt(vec3 sp){
  vec3 q = fieldPoint(sp);
  return warpedFbm(q, 6) + 0.10*(fbm(q*5.0, 5) - 0.5) + 0.03*(fbm(q*17.0, 3) - 0.5);
}

// 16-bit fixed point across two 8-bit channels.
vec2 pack16(float v){
  float x = clamp(v, 0.0, 1.0) * 65535.0;
  float hi = floor(x / 256.0);
  return vec2(hi, x - hi*256.0) / 255.0;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 sp = faceDir(uFace, uv);
  vec3 q = fieldPoint(sp);

  float cont   = warpedFbm(q, 6);
  float detail = fbm(q*5.0, 5);
  float fine   = fbm(q*17.0, 3);
  float mount  = ridged(q*3.4, 5);
  float floe   = fbm(q*9.0, 4);

  // Surface normal, finite-differenced from the height field along two tangent
  // directions. Doing it here is what removes the four extra surface
  // evaluations the relief shading used to cost every frame.
  vec3 tang  = normalize(cross(sp, abs(sp.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0)));
  vec3 bitan = cross(sp, tang);
  const float eps = 0.012;
  float hx0 = heightAt(normalize(sp - tang*eps));
  float hx1 = heightAt(normalize(sp + tang*eps));
  float hy0 = heightAt(normalize(sp - bitan*eps));
  float hy1 = heightAt(normalize(sp + bitan*eps));
  // Stored as a slope pair in [0,1]; the runtime shader recovers the shading
  // term from it exactly as it used to from the live samples.
  vec2 slope = vec2(hx1 - hx0, hy1 - hy0);
  vec2 enc = clamp(slope * 8.0 + 0.5, 0.0, 1.0);

  // `cont` sits near 0.5 with a narrow useful range; the height that matters is
  // this combination, and it needs 16 bits or every coastline stair-steps.
  float h = cont + 0.10*(detail - 0.5) + 0.03*(fine - 0.5);

  oTerrain = vec4(pack16(h), detail, fine);
  oDetail  = vec4(mount, floe, enc);
}
