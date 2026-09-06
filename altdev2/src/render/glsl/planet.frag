#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uSpin;        // planet rotation phase
uniform vec3  uSunDir;
uniform vec3  uStarColor;
uniform vec3  uVegColor;    // photosynthetic surface colour under this star
uniform float uSeed;
uniform float uOceanFrac;
uniform float uSeaLevel;
uniform float uBio;    // threshold on the baked height that puts the coast in the right place
#ifdef BODY_MAP
uniform sampler2D uBodyMap;     // a real world's albedo, equirectangular
uniform sampler2D uBodyHeight;  // its topography, matched to the terrain distribution
uniform float uBodyMix;         // 0 = procedural, 1 = the real thing
uniform float uBodyHasHeight;   // not every body has a usable DEM
uniform float uBodySeaLevel;    // source photograph's shoreline; < 0 = none
const float BODY_COAST_LOW = -0.002;
const float BODY_COAST_HIGH = 0.003;
#endif
uniform float uWaterCap;    // 0 = bone dry, 1 = plenty of water for snow/sea
uniform float uGlaciated;   // share of frozen land carrying an ice sheet

// The baked surface fields. Everything that does not change with the climate
// lives here now, computed once per world instead of hundreds of times per
// pixel per frame.
uniform samplerCube uTerrain;   // R,G = height (16-bit), B = detail, A = fine
uniform samplerCube uDetailMap; // R = mount, G = floe, B,A = slope pair
uniform samplerCube uCloudMap;  // R = broad deck, G = churn, B = warp, A = banding
uniform float uRelief;          // 0 disables relief shading (low quality)
uniform float uCloudDetail;     // 1 = full churn, 0 = single sample
uniform float uCloud;       // mean cloud cover 0..1
uniform float uSteam;       // 0..1 thick steam envelope
uniform float uAtmoThick;   // shell thickness as a fraction of the planet radius
uniform float uVeil;        // 0..1 how completely the air hides the ground
uniform float uHaze;        // 0..1 organic haze, orange and opaque
uniform float uPTot;        // bar
uniform float uCO2;         // 0..1 how CO2-dominated the air is
uniform float uMagma;       // 0..1 molten surface
uniform float uLocked;      // 0 = free rotator, 1 = tidally locked
uniform float uZoom;        // camera distance, 1 = default framing
uniform float uTilt;        // obliquity, radians: the spin axis leans this far
// Camera orbit and elevation, radians. Paired into one vec2 rather than kept as
// two floats because a uniform vector slot holds four components either way, so
// two scalars cost two slots and a vec2 costs one -- and the fragment stage is
// at its guaranteed budget of 32. That freed the slot uVolcano needed.
uniform vec2  uCam;         // x = orbit, y = elevation
// x = melt production relative to Earth's, on a 0..1 curve; y = the ash and
// sulphate veil that comes with it.
uniform vec2  uVolcano;
uniform float uNightGlow;   // thermal emission on the dark side
// Per-band temperature and ice, as a texture rather than two uniform arrays.
// Uniform arrays cost a vector each -- 36 of them, against a WebGL1 guaranteed
// maximum of 16 -- and indexing them with a computed index is only OPTIONAL in
// GLSL ES 1.00, so drivers may legally refuse it. A texture has neither problem:
// the coordinate is a float, and it costs one sampler.
//   R,G = temperature packed to 16 bits over 0..4000 K
//   B   = ice fraction
uniform sampler2D uBands;

// Texture path. uUseTex fades between the fully procedural look (0) and the
// generated albedo maps (1), so the two versions share all the same lighting,
// climate response and atmosphere -- only the surface albedo differs.
uniform float uUseTex;
#ifndef NO_ALBEDO
uniform sampler2D uTexRock;
uniform sampler2D uTexDesert;
uniform sampler2D uTexVeg;
uniform sampler2D uTexIce;
uniform sampler2D uTexOcean;
uniform sampler2D uTexLava;
#endif

const float PI = 3.14159265;

//__NOISE__

// ---------- band lookup ----------
// Sampled with NEAREST, so each fetch lands squarely on one texel and the
// interpolation between neighbours stays explicit -- filtering the two halves of
// a packed 16-bit value independently would produce nonsense at every boundary.
float bandTexel(float i, int which){
  vec4 c = texture(uBands, vec2((i + 0.5) / 18.0, 0.5));
  if(which == 0) return (c.r * 65280.0 + c.g * 255.0) / 65535.0 * 4000.0;
  return c.b;
}

float bandVal(float x, int which){
  float f = clamp((x+1.0)*0.5, 0.0, 0.99999) * 18.0 - 0.5;
  float i0 = floor(max(f, 0.0));
  float i1 = min(i0 + 1.0, 17.0);
  float t = clamp(f - i0, 0.0, 1.0);
  return mix(bandTexel(i0, which), bandTexel(i1, which), t);
}

mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
// Bring a direction into the planet's own frame, whose spin axis leans by the
// obliquity. Leaning about X keeps the tilt broadside to the default view, so
// it is visible rather than hidden edge-on.
mat3 tiltFrame(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

// ---------- surface colour ----------
// Returns albedo; height comes back so main() can shade slopes, and shininess
// drives the specular glint off water and ice.
// Unpack the 16-bit height the bake wrote across two channels.
float unpack16(vec2 c){ return (c.x*255.0*256.0 + c.y*255.0) / 65535.0; }

const vec3 SOLAR_VEG = vec3(0.14117647, 0.47843137, 0.09411765);
vec3 stellarVegetation(vec3 source){
  float sourceLum = dot(source, vec3(0.2126,0.7152,0.0722));
  float targetLum = max(dot(uVegColor, vec3(0.2126,0.7152,0.0722)), 0.0001);
  vec3 tinted = clamp(uVegColor * sourceLum / targetLum, 0.0, 1.0);
  float shift = clamp(length(uVegColor - SOLAR_VEG) * 2.5, 0.0, 1.0);
  return mix(source, tinted, shift);
}

#ifdef BODY_MAP
// Equirectangular lookup for a real world's maps. `sp` is planet-fixed, so the
// map turns with the planet and leans with its obliquity like everything else.
vec2 bodyUV(vec3 sp){
  vec3 d = normalize(sp);
  return vec2(atan(d.x, d.z) * 0.15915494 + 0.5, acos(clamp(d.y, -1.0, 1.0)) * 0.31830989);
}
// How much of the real world shows through at this point. Not a flat dissolve:
// it sweeps across the globe following the terrain's own detail field, so a
// world changes region by region -- coastlines staying sharp throughout,
// because every point is always somebody's real coastline -- rather than the
// whole planet going soft at once. Blending two decorrelated height fields
// everywhere flattens the relief and drains the land (measured: 30% -> 18%);
// dissolving them regionally holds it to within a point.
float bodyBlend(float detail){
  float t = clamp(uBodyMix, 0.0, 1.0);
  if(t <= 0.0) return 0.0;
  if(t >= 1.0) return 1.0;
  return clamp((t * 1.5 - 0.25 - (detail - 0.5)) * 5.0, 0.0, 1.0);
}
// Both surface paths -- procedural and generated-texture -- go through these,
// because the coastline must not move when you toggle between them, and
// because a real world showing on only one of them is what happened when the
// textured path had its own copy of this and never got the map.
float bodyCoast(float h){
  return smoothstep(BODY_COAST_LOW, BODY_COAST_HIGH, h);
}
float bodyHeight(float raw, vec2 buv, float bm, out float sourceLand){
  float mapped = 0.30 + 0.40*texture(uBodyHeight, buv).r;
  sourceLand = uBodySeaLevel < 0.0 ? 1.0
    : bodyCoast(mapped - uBodySeaLevel);
  return mix(raw, mix(raw, mapped, uBodyHasHeight), bm);
}
vec3 bodyGround(vec3 ground, vec2 buv, float bm, float life, float sourceLand){
  if(bm <= 0.0) return ground;
  vec3 real = texture(uBodyMap, buv).rgb;
  // The photo's ocean is not permanent paint. Its DEM says which pixels were
  // below the reference shoreline; if the model has since exposed them, show
  // the procedural seabed underneath instead of blue "land".
  real = mix(ground, real, sourceLand);
  // Only the *vegetation* in a photograph is climate-dependent, and only the
  // green in it says vegetation. Muting the whole map wherever life was scarce
  // turned Mars and Venus grey -- their colour is rock, and rock does not care
  // whether anything is growing on it. Earth's forests still brown off when the
  // climate stops supporting them, which is the point.
  float green  = clamp((real.g - max(real.r, real.b) * 0.94) * 4.0, 0.0, 1.0) * sourceLand;
  real = mix(real, stellarVegetation(real), green);
  float wither = green * (1.0 - smoothstep(0.08, 0.45, life));
  vec3 dead = mix(real, vec3(dot(real, vec3(0.38,0.44,0.18))) * vec3(1.12,0.98,0.76), 0.85);
  return mix(ground, mix(real, dead, wither), bm);
}
#endif

// The inverse-normal sea-level lookup is deliberately finite at its endpoints,
// but the climate can truthfully report an exact global ocean. Fade away the
// last quantile-clamped summits as flooded area reaches 100%, so picture and
// readout agree on both mapped and invented terrain.
float floodLand(float land){
  return land * (1.0 - smoothstep(0.998, 0.9999, uOceanFrac));
}

vec3 surfaceColor(vec3 sp, float T, float ice, out float shininess, out float height){
  vec4 terr = texture(uTerrain, sp);
  vec4 det  = texture(uDetailMap, sp);
  float detail = terr.b;
  float fine   = terr.a;

  // Sea level comes from the CPU: it is one number for the whole frame, and
  // the straight line this used to be drew 14.8% land when 30% was asked for.
  float thr = uSeaLevel;
  // Sea level is a threshold on the baked height, so the coastline follows the
  // water inventory without ever needing a rebake.
  float raw = unpack16(terr.rg);
#ifdef BODY_MAP
  // The real topography is stored already matched to the procedural field's own
  // distribution, so the same sea level puts the coast in the right place on
  // both and a blend of the two keeps the land fraction it started with.
  float bm = bodyBlend(detail);
  vec2 buv = bodyUV(sp);
  float sourceLand;
  raw = bodyHeight(raw, buv, bm, sourceLand);
#endif
  float h = raw - thr;
  height = h;
  float land = smoothstep(-0.010, 0.026, h);
#ifdef BODY_MAP
  // Keep a mapped DEM's resolved shoreline narrow, but centre it on the
  // model's current sea level. Using sourceLand here would freeze the coast to
  // the photograph and stop extra oceans from flooding the continents.
  land = mix(land, bodyCoast(h), bm * uBodyHasHeight);
#endif
  // A world with no ocean has no sea basins: low ground is just low ground.
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));
  land = floodLand(land);

  // Mountain belts sit in the continental interiors, as they do on Earth.
  float mount = det.r * smoothstep(0.0, 0.16, h);
  float elev  = max(h, 0.0) + 0.30*mount;

  vec3 rock   = mix(vec3(0.30,0.25,0.21), vec3(0.46,0.39,0.31), detail);
  vec3 rockHi = mix(vec3(0.42,0.38,0.34), vec3(0.58,0.53,0.47), fine);
  vec3 sand   = mix(vec3(0.68,0.50,0.28), vec3(0.86,0.71,0.45), detail);
  vec3 sandHi = mix(vec3(0.78,0.62,0.38), vec3(0.90,0.79,0.56), fine);
  vec3 forest = mix(vec3(0.11,0.26,0.11), vec3(0.24,0.40,0.16), detail);
  vec3 steppe = mix(vec3(0.42,0.44,0.22), vec3(0.56,0.54,0.30), detail);

  // Vegetation needs warmth AND water, thins with altitude, and gives way to
  // steppe before it gives way to desert.
  float warmth = smoothstep(266.0,284.0,T) * (1.0 - smoothstep(303.0,322.0,T));
  float wet    = smoothstep(0.10,0.55,uWaterCap);
  // ...and something has to be alive. This was missing entirely: `life` was
  // warmth and water and nothing else, so a world with the biosphere set to
  // zero, or one cooked past 73 C where photosynthesis has stopped, stayed as
  // green as Earth. uBio is what the planet is actually supporting.
  float lush   = smoothstep(0.02, 0.55, uBio);
  float life   = warmth * wet * lush * (1.0 - smoothstep(0.10,0.30,elev));

  vec3 arid   = mix(sand, sandHi, smoothstep(0.05,0.22,elev));
  vec3 living = mix(stellarVegetation(steppe), stellarVegetation(forest), smoothstep(0.25,0.75,life));
  vec3 ground = mix(arid, living, smoothstep(0.12,0.50,life));
  ground = mix(ground, mix(rock, rockHi, mount), smoothstep(0.12,0.34,elev));
  ground = mix(ground, rock*0.85, smoothstep(0.06,-0.02,h)*0.5);

  float depth = smoothstep(0.0,-0.26,h);
  vec3 sea = mix(mix(vec3(0.16,0.48,0.60), vec3(0.06,0.26,0.47), smoothstep(0.0,0.35,depth)),
                 vec3(0.010,0.055,0.17), smoothstep(0.35,1.0,depth));
  // A drying sea goes briny and pale before it disappears altogether.
  sea = mix(mix(sand, rock, 0.35), sea, smoothstep(0.02,0.25,uWaterCap));

#ifdef BODY_MAP
  // The real map supplies the *ground*, not the water: the sea is drawn by the
  // model, because the model is what decides where the sea is.
  ground = bodyGround(ground, buv, bm, life, sourceLand);
#endif

  vec3 col = mix(sea, ground, land);
  shininess = (1.0-land)*0.9;

  // Sea ice is floe-broken; land ice is a brighter snowfield that takes the
  // high ground first.
  // Sea ice and land ice are drawn separately, because a planet can have one
  // without the other. A frozen ocean still covers its basin, while the
  // continents beside it may be bare frosted rock if no snow reaches them --
  // which is what a hard snowball actually looks like.
  float floe = det.g;
  float snowline = smoothstep(-0.06, 0.22, elev);

  float seaIceAmt = clamp(ice*1.05 - 0.16*floe, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  vec3 seaIceCol = mix(vec3(0.72,0.82,0.90), vec3(0.90,0.95,0.99), floe);
  float seaIceMask = smoothstep(0.06,0.52,seaIceAmt) * (1.0 - land);

  // Ice sheets take the high ground first, and only where snow can reach.
  float sheetAmt = clamp(ice*(0.70 + 0.60*snowline) - 0.18*floe, 0.0, 1.0) * uGlaciated;
  vec3 sheetCol = mix(vec3(0.86,0.90,0.94), vec3(0.99,1.00,1.00), fine);
  float sheetMask = smoothstep(0.06,0.52,sheetAmt) * land;

  // Frozen ground with no ice sheet still frosts over: paler than summer rock,
  // nothing like an ice cap.
  //
  // ...but only if there is water to frost WITH, and that factor was missing
  // here while the physics has had it all along. radiation.js:338 reads
  //
  //     frost = landAlbedo + (ALB_FROST - landAlbedo) * waterCap
  //
  // -- "a bone-dry frozen world stays the colour of its dust" -- and this line
  // is the same statement about the same quantity with the last term dropped.
  // The two then described different planets: a globally frosted Mars runs at
  // 197.6 K against the 212.2 K the model actually computes and the 210 K Mars
  // has. On screen it painted 98% of the disc 55% of the way to grey, which is
  // what "why is Mars a featureless pink ball" turned out to be. It was not
  // even adding the polar caps it looked like it was adding: mars.jpg already
  // carries them at the right latitude and area, and the wash was flattening
  // them from both ends, taking the disc's contrast from 14.1:1 to 2.86:1.
  //
  // waterCap multiplies the STRENGTH rather than the area, because that is
  // where radiation.js puts it -- the ground keeps its own colour and moves
  // toward frost only as far as its water allows.
  float frostMask = clamp(ice, 0.0, 1.0) * land * (1.0 - smoothstep(0.06,0.52,sheetAmt));
  col = mix(col, mix(col, vec3(0.66,0.66,0.68), 0.55 * uWaterCap), frostMask);

  col = mix(col, seaIceCol, seaIceMask);
  col = mix(col, sheetCol, sheetMask);
  float iceMask = max(seaIceMask, sheetMask);
  shininess = mix(shininess, 0.18, iceMask);

  float melt = smoothstep(1150.0,1500.0,T);
  if(melt > 0.001){
    // The lava crust is the one field still evaluated live: it only ever runs
    // on a molten planet, and only inside this branch.
    float crack = ridged4(sp*13.2 + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3));
    float glow  = smoothstep(0.45,0.95,crack);
    vec3 crust  = mix(vec3(0.05,0.04,0.04), vec3(0.14,0.11,0.10), detail);
    vec3 magma  = mix(vec3(0.85,0.16,0.02), vec3(1.0,0.85,0.35), pow(glow,2.0));
    col = mix(col, mix(crust, magma, glow), melt);
    shininess = mix(shininess, 0.0, melt);
  }
  return col;
}

// Equirectangular lookup for a point on the unit sphere.
vec2 sphereUV(vec3 p){
  return vec2(atan(p.z, p.x)/(2.0*PI) + 0.5, acos(clamp(p.y,-1.0,1.0))/PI);
}

// The same climate logic as surfaceColor(), but the palettes come from the
// generated albedo maps instead of noise. Blending is driven by exactly the
// same masks, so a planet looks like the same planet either way.
#ifndef NO_ALBEDO
vec3 surfaceTextured(vec3 sp, float T, float ice, out float shininess, out float height){
  float shinP, hP;
  vec3 proc = surfaceColor(sp, T, ice, shinP, hP);   // reuse its masks
  height = hP; shininess = shinP;

  vec2 uv = sphereUV(sp);
  vec2 uvD = uv * vec2(2.0, 1.0);      // detail scale, tiles horizontally

  vec3 tRock  = texture(uTexRock,   uvD).rgb;
  vec3 tSand  = texture(uTexDesert, uvD).rgb;
  vec3 tVeg   = texture(uTexVeg,    uvD).rgb;
  vec3 tIce   = texture(uTexIce,    uvD).rgb;
  vec3 tSea   = texture(uTexOcean,  uvD).rgb;
  vec3 tLava  = texture(uTexLava,   uvD).rgb;

  vec4 terr = texture(uTerrain, sp);
  vec4 det  = texture(uDetailMap, sp);
  float detail = terr.b, fine = terr.a;
  float raw = unpack16(terr.rg);
#ifdef BODY_MAP
  float bm = bodyBlend(detail);
  vec2 buv = bodyUV(sp);
  float sourceLand;
  raw = bodyHeight(raw, buv, bm, sourceLand);
#endif
  float h = raw - uSeaLevel;
  float land = smoothstep(-0.010, 0.026, h);
#ifdef BODY_MAP
  land = mix(land, bodyCoast(h), bm * uBodyHasHeight);
#endif
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));
  land = floodLand(land);
  float mount = det.r * smoothstep(0.0, 0.16, h);
  float elev  = max(h, 0.0) + 0.30*mount;

  float warmth = smoothstep(266.0,284.0,T) * (1.0 - smoothstep(303.0,322.0,T));
  float wet    = smoothstep(0.10,0.55,uWaterCap);
  // ...and something has to be alive. This was missing entirely: `life` was
  // warmth and water and nothing else, so a world with the biosphere set to
  // zero, or one cooked past 73 C where photosynthesis has stopped, stayed as
  // green as Earth. uBio is what the planet is actually supporting.
  float lush   = smoothstep(0.02, 0.55, uBio);
  float life   = warmth * wet * lush * (1.0 - smoothstep(0.10,0.30,elev));

  tVeg = stellarVegetation(tVeg);
  vec3 ground = mix(tSand, tVeg, smoothstep(0.12,0.50,life));
  ground = mix(ground, tRock, smoothstep(0.12,0.34,elev));
#ifdef BODY_MAP
  // This is the default surface style, so leaving the real map out here meant a
  // real world only appeared if you switched to the procedural one.
  ground = bodyGround(ground, buv, bm, life, sourceLand);
#endif

  float depth = smoothstep(0.0,-0.26,h);
  vec3 sea = tSea * mix(1.15, 0.35, smoothstep(0.0,1.0,depth));
  sea = mix(mix(tSand, tRock, 0.35), sea, smoothstep(0.02,0.25,uWaterCap));

  vec3 col = mix(sea, ground, land);

  float floe = det.g;
  float snowline = smoothstep(-0.06, 0.22, elev);
  float seaIceAmt = clamp(ice*1.05 - 0.16*floe, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  float sheetAmt  = clamp(ice*(0.70 + 0.60*snowline) - 0.18*floe, 0.0, 1.0) * uGlaciated;
  // Same water gate as the procedural path above, for the same reason.
  float frostMask = clamp(ice,0.0,1.0) * land * (1.0 - smoothstep(0.06,0.52,sheetAmt));
  col = mix(col, mix(col, vec3(0.66,0.66,0.68), 0.55 * uWaterCap), frostMask);
  col = mix(col, tIce, smoothstep(0.06,0.52,seaIceAmt) * (1.0 - land));
  col = mix(col, tIce, smoothstep(0.06,0.52,sheetAmt) * land);

  float melt = smoothstep(1150.0,1500.0,T);
  col = mix(col, tLava, melt);

  // Keep a little of the procedural tint so climate colour cues survive.
  return mix(col, proc, 0.22);
}
#endif

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  // Dragging orbits the camera rather than turning the planet, so the star, the
  // terminator and the ice caps all stay where they belong while you look from
  // a new angle.
  mat3 view = rotY(uCam.x) * rotX(uCam.y);
  // Zoom by moving the camera rather than narrowing the lens, so the planet
  // keeps its perspective and the atmosphere's limb still reads correctly.
  vec3 ro = view * vec3(0.0, 0.0, 3.0 * uZoom);
  vec3 rd = view * normalize(vec3(uv*2.05, -1.6));

  vec3 col = vec3(0.0);

  // ---- starfield ----
  vec3 sdir = normalize(rd + vec3(0.0,0.0,0.0));
  float sf = hash(floor(sdir*260.0));
  float stars = pow(smoothstep(0.9975, 1.0, sf), 1.0);
  float tw = 0.7 + 0.3*sin(uTime*1.7 + sf*80.0);
  col += vec3(0.85,0.9,1.0)*stars*tw*1.4;
  col += vec3(0.02,0.03,0.06) * (0.6 + 0.4*gnoise(sdir*2.0));

  // ---- sphere intersection ----
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b*b - c;

  // Thickness comes from the CPU now, because the two modes need different
  // physics: the stylised one grows with the logarithm of surface pressure so a
  // thick atmosphere reads at a glance, while the realistic one is a real scale
  // height and is consequently a thin bright rim -- Earth's air is 0.7% of its
  // radius, not the 30% a diagram would draw. An airless rock wears no halo
  // either way.
  float airAmount = smoothstep(0.0, 0.02, uPTot);
  float atmoThick = airAmount * uAtmoThick;
  float Ra = 1.0 + atmoThick;
  float bA = dot(ro, rd), cA = dot(ro,ro) - Ra*Ra;
  float dA = bA*bA - cA;

  vec3 airTint = mix(vec3(0.35,0.60,1.0), vec3(1.0,0.72,0.34), uCO2);
  airTint = mix(airTint, vec3(1.0,0.96,0.92), uSteam);
  // Tholin haze is orange and it is the top of the atmosphere, so it colours
  // both the rim and whatever it hides.
  airTint = mix(airTint, vec3(0.93,0.62,0.26), uHaze);

  bool hitPlanet = disc > 0.0;

  if(hitPlanet){
    float t = -b - sqrt(disc);
    vec3 pos = ro + rd*t;
    vec3 n = normalize(pos);

    // Planet-fixed coordinates. The spin axis leans by the obliquity, so the
    // whole planet -- its bands, its ice caps and its surface -- tilts together,
    // and the terminator then cuts across the latitudes at an angle instead of
    // running straight down the poles. Without this the axial tilt controlled
    // the seasons in the physics and was invisible on the globe.
    vec3 nT = tiltFrame(uTilt) * n;
    vec3 sp = rotY(-uSpin) * nT;
    // for a locked world the band axis runs from the substellar point
    float bandX = mix(nT.y, dot(n, uSunDir), uLocked);
    float T = bandVal(bandX, 0);
    float ice = bandVal(bandX, 1);

    float shin, height;
    vec3 base = surfaceColor(sp, T, ice, shin, height);
#ifndef NO_ALBEDO
    if(uUseTex > 0.001){
      float shinT, hT;
      vec3 tex = surfaceTextured(sp, T, ice, shinT, hT);
      base = mix(base, tex, uUseTex);
    }
#endif

    // Relief shading, from the slope the bake already measured. This used to
    // cost four more full surface evaluations per pixel -- 140 of the 269 noise
    // calls -- for a number that never changes once the world is generated.
    vec2 slope = (texture(uDetailMap, sp).ba - 0.5) / 8.0;
    float relief = clamp(1.0 + 5.5*(slope.x*0.6 + slope.y*0.8), 0.55, 1.5);
    relief = mix(1.0, relief, smoothstep(-0.02, 0.06, height) * uRelief);
    base *= relief;

    float ndl = dot(n, uSunDir);
    float lam = smoothstep(-0.12, 0.22, ndl);

    // Sun-glitter off water and ice. Real sea glint is a narrow lobe that
    // brightens towards grazing angles, so it needs a high exponent and a
    // Fresnel weight; a broad, strong lobe reads as the star shining straight
    // through the planet.
    vec3 h = normalize(uSunDir - rd);
    float grazing = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    float spec = pow(max(dot(n,h),0.0), 260.0) * shin * lam * (0.10 + 0.90*grazing);

    vec3 lit = base * (0.06 + 0.94*lam) * uStarColor;
    lit += uStarColor * spec * 0.30;

    // Thermal emission from a hot or molten surface, visible on the night side.
    //
    // Driven by the LOCAL band temperature, not by the planet's mean. That was
    // the bug: a world with a 1270 K day side and a 692 K night side has a
    // 920 K mean, and the mean was painting a glow across ground that emits
    // essentially nothing. See thermalGlow() in terrain.js -- the constants
    // below are that same curve and the self-test pins the two together.
    //
    // uNightGlow is only a gate now: 1 where some band on the planet is hot
    // enough to glow at all, 0 where none is, so a cold world skips the term.
    float glow = uNightGlow * min(exp(11.68 - 17520.0/max(T, 1.0)), 1.4);
    lit += vec3(1.0,0.30,0.08) * glow * (1.0 - lam);

    // ---- volcanism ----
    //
    // Vents, on the unlit side. This is what a volcanic world actually looks
    // like from orbit: not a red planet, but points of light on the dark half.
    // Io is the case -- its eruptions are visible against a night side that is
    // otherwise nothing, and Earth's would be too if there were enough of them.
    //
    // Placed on the terrain's own fine channel rather than on new noise, so a
    // vent sits in the same spot every frame and turns with the planet. The
    // threshold walks down as activity rises, which is how more of them appear:
    // the field is fixed and the level through it is not.
    if (uVolcano.x > 0.001) {
      float f = texture(uTerrain, sp).a;
      // Land only. A vent under an ocean is a black smoker, and what reaches
      // the surface from one is a plume, not a glow.
      float dry = smoothstep(-0.01, 0.03, height);
      float lo = mix(0.92, 0.55, uVolcano.x);
      float vent = smoothstep(lo, lo + 0.05, f) * dry;
      // Fresh flows, dark and unweathered, around the same points in daylight.
      lit = mix(lit, lit * 0.55, vent * 0.5 * lam * uVolcano.x);
      // ...and the incandescence, which only reads on the night side. Slow
      // breathing so a vent field looks alive rather than printed on.
      float pulse = 0.75 + 0.25 * sin(uTime * 0.7 + f * 40.0);
      lit += vec3(1.0, 0.42, 0.10) * vent * pulse * (1.0 - lam) * uVolcano.x * 1.6;
    }

    // ---- clouds ----
    // Two layers drifting at different speeds, warped by their own noise, so
    // the deck churns and shears the way weather does instead of sliding past
    // as one rigid sheet. Banding follows latitude on a fast rotator; on a
    // tidally locked world the deck piles over the substellar point instead.
    // The deck is baked; the motion comes from turning the direction it is
    // sampled along. Two layers rotated at different rates still shear against
    // each other, and a third sample warps them so the churn is not rigid.
    vec3 cq = rotY(-uSpin*1.12) * tiltFrame(uTilt) * n;
    float flow = uTime*0.010;
    float w = texture(uCloudMap, rotY(flow*0.35) * cq).b - 0.5;
    vec3 cqA = normalize(rotY(flow) * cq + vec3(w*0.22, w*0.10, -w*0.16));
    float lo = texture(uCloudMap, cqA).r;
    float hi = uCloudDetail > 0.5
             ? texture(uCloudMap, normalize(rotY(-flow*1.9) * cq + vec3(-w*0.3, w*0.2, w*0.24))).g
             : lo;
    float cl = lo*0.68 + hi*0.32;

    float bands = 0.5 + 0.5*sin(n.y*13.0 + texture(uCloudMap, cq).a*6.0);
    cl = mix(cl, cl*0.62 + 0.38*bands, 0.42*(1.0-uLocked));

    float sub = smoothstep(0.0, 0.9, dot(n, uSunDir));
    float cover = clamp(uCloud + uLocked*sub*0.35, 0.0, 1.0);
    float cmask = smoothstep(1.0-cover, 1.0-cover+0.26, cl);
    cmask = max(cmask, uSteam);

    // Thicker cloud is brighter and casts a little shadow at its edges, which
    // is what stops the deck looking like flat white paint.
    float thick = smoothstep(1.0-cover, 1.0-cover+0.45, cl);
    vec3 cloudCol = mix(vec3(0.86,0.88,0.92), vec3(1.0,0.99,0.97), thick);
    cloudCol = mix(cloudCol, vec3(0.98,0.86,0.72), uCO2*0.5);
    lit *= 1.0 - 0.22*cmask*(1.0-thick);                  // shadowed edges
    lit = mix(lit, cloudCol * uStarColor * (0.10 + 0.90*lam), cmask*0.82);

    // What the eye would actually see. A deep atmosphere is not a window: 92
    // bar of CO2 scatters so hard that Venus shows only cloud tops, and Titan's
    // haze hides its surface completely. uVeil is that opacity, and it is only
    // applied in the realistic mode -- the stylised one keeps showing the
    // ground, which is the whole point of looking at a climate model.
    vec3 veilCol = mix(airTint, vec3(0.86,0.88,0.92), 1.0 - uHaze) * uStarColor;
    lit = mix(lit, veilCol * (0.12 + 0.88*lam), uVeil);

    // Ash and sulphate, the daylight half of the same story. A heavily volcanic
    // world is not only bright spots at night: it is hazy by day, because
    // sulphur dioxide oxidises to a sulphate aerosol that stays up for years.
    // Pinatubo put 20 Tg of it into the stratosphere and cooled the planet half
    // a kelvin; a world erupting continuously never clears it. Yellow-grey and
    // slightly brightening, unlike the organic haze, which is orange and dims.
    if (uVolcano.y > 0.001) {
      vec3 ash = vec3(0.78, 0.74, 0.62) * uStarColor;
      lit = mix(lit, ash * (0.18 + 0.82*lam), uVolcano.y * (0.25 + 0.55*lam));
    }

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
  // Only where the planet does not stand in the way. This used to be added
  // unconditionally, which was invisible from the default viewpoint -- the star
  // sits behind the camera there -- but the moment you drag the view round far
  // enough to put the star behind the planet, it shone straight through a solid
  // world at twenty times the brightness of the surface.
  if(!hitPlanet){
    vec3 sunDirScreen = normalize(uSunDir);
    float sd = max(dot(normalize(rd), sunDirScreen), 0.0);
    col += uStarColor * pow(sd, 900.0) * 3.0;
    col += uStarColor * pow(sd, 24.0) * 0.05;
  }

  // tonemap
  col = col / (col + vec3(0.85));
  col = pow(col, vec3(1.0/2.2));
  fragColor = vec4(col, 1.0);
}
