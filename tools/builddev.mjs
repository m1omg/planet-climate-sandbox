// Build the /dev/ copy of the site.
//
// GitHub Pages serves main:/ directly, so the work-in-progress build lives in a
// dev/ directory on main rather than on its own branch. This produces that
// directory from whatever is checked out, so the copy is never hand-edited and
// never drifts from the branch it is supposed to be showing.
//
//   node tools/builddev.mjs ../path/to/main/checkout
//
// Two things differ from the root copy, and only two:
//
//   * window.__assetBase points at ../assets/, so this copy borrows the 23 MB of
//     surface maps already at the site root rather than shipping a second set;
//   * a banner saying what is broken.
//
// The banner is pointer-events:none with only its dismiss button clickable, and
// it is one line tall with the text ellipsised. It sits over the page, and a
// notice about a dev build has no business being able to intercept a click meant
// for the app underneath it -- which is exactly what it did on a small laptop,
// where it covered the controls.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: node tools/builddev.mjs <path-to-main-checkout>'); process.exit(1); }
const dev = join(out, 'dev');

const NOTE = 'four-band radiation, hydrogen and Hycean work in progress — 24 of 213 self-tests failing';

rmSync(dev, { recursive: true, force: true });
mkdirSync(dev, { recursive: true });
for (const d of ['css', 'src']) cpSync(join(root, d), join(dev, d), { recursive: true });

let html = readFileSync(join(root, 'index.html'), 'utf8');
const tag = '<script type="module" src="src/main.js"></script>';
if (!html.includes(tag)) { console.error('module script tag not found in index.html'); process.exit(1); }
html = html.replace(tag, '<script>window.__assetBase = "../assets/";</script>\n' + tag);
html = html.replace('<title>', '<title>[dev] ');

const banner = `<div id="devbar"><span class="devbar-tag">DEV</span><span class="devbar-msg">${NOTE}</span>` +
  `<a class="devbar-link" href="../">stable site</a>` +
  `<button type="button" class="devbar-x" aria-label="Dismiss">×</button></div>
<style>
#devbar{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;gap:.5rem;
  padding:.15rem .5rem;background:rgba(122,47,22,.94);color:#ffe9d6;
  font:11px/1.5 system-ui,-apple-system,sans-serif;
  /* A notice must never eat a click meant for the app underneath it. */
  pointer-events:none}
#devbar.gone{display:none}
.devbar-tag{font-weight:700;letter-spacing:.06em;flex:none}
.devbar-msg{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.92}
.devbar-link{color:#ffd0ae;flex:none;pointer-events:auto}
.devbar-x{flex:none;pointer-events:auto;cursor:pointer;background:none;border:0;color:#ffe9d6;
  font-size:15px;line-height:1;padding:0 .2rem}
@media (max-width:900px){.devbar-msg{display:none}}
</style>
<script>
(function(){
  var bar=document.getElementById('devbar');
  try{ if(localStorage.getItem('devbar.dismissed')==='1') bar.classList.add('gone'); }catch(e){}
  bar.querySelector('.devbar-x').addEventListener('click',function(){
    bar.classList.add('gone');
    try{ localStorage.setItem('devbar.dismissed','1'); }catch(e){}
  });
})();
</script>
`;
const i = html.indexOf('>', html.indexOf('<body')) + 1;
html = html.slice(0, i) + '\n' + banner + html.slice(i);
writeFileSync(join(dev, 'index.html'), html);

writeFileSync(join(dev, 'README.md'), `# /dev — the development build

Built by \`tools/builddev.mjs\` from the \`claude/project-status-review-mhk04n\`
branch and served at <https://m1omg.github.io/planet-climate-sandbox/dev/>.

**Do not edit anything in here.** Edit the branch and rebuild:

\`\`\`bash
node tools/builddev.mjs /path/to/main/checkout
\`\`\`

\`assets/\` is deliberately absent: this copy sets \`window.__assetBase\` to
\`../assets/\` and borrows the surface maps at the site root, which is 668 KB
instead of 23 MB.

**This build is knowingly not green** — ${NOTE}. Two of those failures are tests
asserting the *old* deviation: snowball deglaciation now lands at 143 mbar
against the literature's 100–300, where it used to be thirty times too low.
`);
console.log(`built ${dev}`);
