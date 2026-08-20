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
