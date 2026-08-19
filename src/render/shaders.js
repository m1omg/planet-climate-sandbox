// The planet shader lives in src/render/glsl/*.glsl as real GLSL files: it is
// far easier to edit and diff there than inside a JavaScript template literal,
// where a stray backtick silently breaks the whole module.
const base = new URL('./glsl/', import.meta.url);

async function load(name) {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`could not load shader ${name}: ${res.status}`);
  return res.text();
}

export async function loadShaders() {
  const [vert, frag] = await Promise.all([load('planet.vert'), load('planet.frag')]);
  return { vert, frag };
}
