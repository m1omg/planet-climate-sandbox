// The planet shaders live in src/render/glsl/ as real GLSL files: far easier to
// edit and diff there than inside a JavaScript template literal, where a stray
// backtick silently breaks the whole module.
//
// The noise functions are kept in one file and spliced into every program that
// needs them. The bake and the runtime shader MUST agree exactly -- the bake
// writes the fields the runtime reads -- and sharing one source is what
// guarantees they cannot drift apart.
const base = new URL('./glsl/', import.meta.url);

async function load(name) {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`could not load shader ${name}: ${res.status}`);
  return res.text();
}

// Mechanically rewrite GLSL ES 3.00 as ES 1.00, so a WebGL1 context can run the
// same shaders. WebGL2 is refused often enough -- a graphics blocklist entry is
// all it takes -- that having a real GPU fallback matters, and WebGL1 draws the
// planet at full speed and resolution where the software path cannot.
//
// The noise source is already written to compile under both, so this only has to
// deal with the language changes.
const CUBE_SAMPLERS = ['uTerrain', 'uDetailMap', 'uCloudMap'];

export function toES100(src, stage) {
  let out = src.replace(/^#version[^\n]*\n/, '');
  // High precision is optional in ES 1.00 fragment shaders; ask for it only
  // where the compiler says it exists.
  if (stage === 'frag') {
    out = out.replace(/^\s*precision\s+highp\s+float;\s*$/m,
      '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif');
  }
  // Multiple render targets do not exist in WebGL1; the bake runs two passes
  // instead, selecting its output with uTarget.
  out = out.replace(/layout\(location\s*=\s*(\d+)\)\s*out\s+vec4\s+(\w+)\s*;/g,
                    (_, i, name) => `#define ${name} ${i === '0' ? 'OUT0' : 'OUT1'}\nvec4 ${i === '0' ? 'OUT0' : 'OUT1'};`);
  out = out.replace(/^\s*out\s+vec4\s+(\w+)\s*;/gm, (_, name) => `#define ${name} gl_FragColor`);
  if (stage === 'vert') {
    out = out.replace(/^\s*in\s+/gm, 'attribute ').replace(/^\s*out\s+/gm, 'varying ');
  } else {
    out = out.replace(/^\s*in\s+/gm, 'varying ');
  }
  // texture() splits back into texture2D()/textureCube() by sampler type.
  const cubeRe = new RegExp(`\\btexture\\(\\s*(${CUBE_SAMPLERS.join('|')})\\b`, 'g');
  out = out.replace(cubeRe, 'textureCube($1');
  out = out.replace(/\btexture\(/g, 'texture2D(');
  out = out.replace(/\btextureCube2D\(/g, 'textureCube(');
  return out;
}

// The bake writes two targets. WebGL1 has no MRT, so the same shader is run
// twice and picks its output.
export function bakeES100(src) {
  let out = toES100(src, 'frag');
  out = out.replace('void main(){', 'uniform int uTarget;\nvoid main(){');
  out = out.replace(/\}\s*$/, '  gl_FragColor = uTarget == 0 ? OUT0 : OUT1;\n}\n');
  return out;
}

export async function loadShaders() {
  const [vert, frag, bakeVert, bakeFrag, cloudFrag, noise] = await Promise.all([
    load('planet.vert'), load('planet.frag'),
    load('bake.vert'), load('bake.frag'), load('cloudbake.frag'),
    load('noise.glsl'),
  ]);
  const splice = (src) => src.replace('//__NOISE__', noise);
  return {
    vert,
    frag: splice(frag),
    bakeVert,
    bakeFrag: splice(bakeFrag),
    cloudFrag: splice(cloudFrag),
  };
}
