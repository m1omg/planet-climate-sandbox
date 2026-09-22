#version 300 es
precision highp float;

// Clouds are the one field that genuinely moves, so they cannot be baked
// outright. What can be baked is the field itself; the motion then comes from
// animating the direction it is looked up along, which costs three fetches
// instead of twenty-one noise evaluations.

uniform vec2  uSize;
uniform int   uFace;
// The world's seed. planet.js has always set it for this program, and the
// program never declared it, so every world -- invented or real -- was baked
// the same cloud deck. Same offset rule as the terrain bake's fieldPoint().
uniform float uSeed;

//__NOISE__

out vec4 oCloud;

vec3 faceDir(int face, vec2 uv){
  vec2 t = uv * 2.0 - 1.0;
  if(face == 0) return normalize(vec3( 1.0, -t.y, -t.x));
  if(face == 1) return normalize(vec3(-1.0, -t.y,  t.x));
  if(face == 2) return normalize(vec3( t.x,  1.0,  t.y));
  if(face == 3) return normalize(vec3( t.x, -1.0, -t.y));
  if(face == 4) return normalize(vec3( t.x, -t.y,  1.0));
  return              normalize(vec3(-t.x, -t.y, -1.0));
}

void main(){
  vec3 cq = faceDir(uFace, gl_FragCoord.xy / uSize)
          + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3);
  // Three scales: the broad deck, the churn within it, and the warp field that
  // shears one against the other at runtime.
  float lo   = fbm5(cq*2.4);
  float hi   = fbm4(cq*6.5);
  float warp = fbm3(cq*1.7);
  float band = fbm3(cq*3.0);
  oCloud = vec4(lo, hi, warp, band);
}
