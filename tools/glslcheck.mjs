// Parses the planet shaders with a real GLSL ES 3.0 grammar. Actually compiling
// them needs a GPU, which a headless box does not have, so this is the closest
// thing to a compile check available here: it catches syntax and structural
// errors before they reach a browser and blank the page.
import { parse } from '/home/mroz/.nvm/versions/node/v20.20.2/lib/node_modules/@shaderfrog/glsl-parser/parser/parser.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
let failed = 0;

for (const f of ['src/render/glsl/planet.vert', 'src/render/glsl/planet.frag']) {
  let src = readFileSync(join(root, f), 'utf8');
  // The grammar does not take the #version directive itself.
  src = src.replace(/^#version[^\n]*\n/, '');
  try {
    parse(src, { quiet: true });
    console.log(`\x1b[32mPASS\x1b[0m  ${f}`);
  } catch (e) {
    failed++;
    const msg = String(e.message).split('\n').slice(0, 4).join('\n        ');
    console.log(`\x1b[31mFAIL\x1b[0m  ${f}\n        ${msg}`);
  }
}
console.log(failed ? `\n${failed} shader(s) failed to parse` : '\nshaders parse cleanly');
process.exit(failed ? 1 : 0);
