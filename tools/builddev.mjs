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
//   * window.__storageScope names the directory, so this copy's saves, discovery
//     log and preferences sit in their own corner of localStorage instead of in
//     the stable site's. localStorage is keyed by origin and not by path, and
//     all three builds are one origin;
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
import { execFileSync } from 'node:child_process';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: node tools/builddev.mjs <path-to-main-checkout>'); process.exit(1); }
// The directory this build is served from, which is also its storage namespace
// and the word in its banner.
const NAME = 'dev';
const dev = join(out, NAME);

const NOTE = 'Goldblatt runaway limit, saturating hot branch, refitted methane, four-band radiation, the two star modes, the prokaryote/eukaryote split and Hycean work in progress \u2014 known gaps reported by calibrate.mjs';
// The Huronian entry below is kept because it was reported from this build twice.

// Which branch this copy came from. Asked of git rather than written down here,
// because the written-down one went stale the moment the work moved to another
// branch and the /dev/ README then named a branch that was no longer being
// built. A detached HEAD or a tarball gets the honest answer instead of a lie.
let BRANCH;
try {
  BRANCH = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: root, encoding: 'utf8' }).trim();
  if (!BRANCH || BRANCH === 'HEAD') BRANCH = null;
} catch { BRANCH = null; }

rmSync(dev, { recursive: true, force: true });
mkdirSync(dev, { recursive: true });
for (const d of ['css', 'src']) cpSync(join(root, d), join(dev, d), { recursive: true });

let html = readFileSync(join(root, 'index.html'), 'utf8');
const tag = '<script type="module" src="src/main.js"></script>';
if (!html.includes(tag)) { console.error('module script tag not found in index.html'); process.exit(1); }
html = html.replace(tag, `<script>window.__assetBase = "../assets/"; window.__storageScope = "${NAME}";</script>\n` + tag);
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
  var k='planetclimate.${NAME}.devbar.v1';
  try{ if(localStorage.getItem(k)==='1') bar.classList.add('gone'); }catch(e){}
  bar.querySelector('.devbar-x').addEventListener('click',function(){
    bar.classList.add('gone');
    try{ localStorage.setItem(k,'1'); }catch(e){}
  });
})();
</script>
`;
const i = html.indexOf('>', html.indexOf('<body')) + 1;
html = html.slice(0, i) + '\n' + banner + html.slice(i);
writeFileSync(join(dev, 'index.html'), html);

writeFileSync(join(dev, 'README.md'), `# /dev — the development build

Built by \`tools/builddev.mjs\` from ${BRANCH ? `the \`${BRANCH}\`\nbranch` : 'a detached checkout'} and served at <https://m1omg.github.io/planet-climate-sandbox/dev/>.

**Do not edit anything in here.** Edit the branch and rebuild:

\`\`\`bash
node tools/builddev.mjs /path/to/main/checkout
\`\`\`

\`assets/\` is deliberately absent: this copy sets \`window.__assetBase\` to
\`../assets/\` and borrows the surface maps at the site root, which is 668 KB
instead of 23 MB.

Its saves, preferences and discovery log are its own. \`localStorage\` is keyed by
origin and not by path, so this copy, the stable site and \`/altdev/\` shared one
set of keys until \`src/game/storage.js\` split them — and slot 1 is the autosave,
firing every thirty seconds, so a minute here wrote over a world saved there.
Keys are \`planetclimate.${NAME}.*\`; the site root keeps the bare ones it has
always used. A namespace opened for the first time copies what was in the shared
keys, so nothing looks lost; it is a copy, and the stable site keeps everything.

Worlds still cross between builds the way they should — the URL hash and the
export file carry parameters rather than physics state.

**This build is knowingly not green** — ${NOTE}. \`selftest.js\` has seventeen
standing failures, every one of them a test asserting a deviation the README
names and explains; two of them assert the *old* deviation, since snowball
deglaciation now lands at 140 mbar against the literature's 100–300 where it
used to be thirty times too low. \`calibrate.mjs\` passes all 28 of its anchors
and reports eight known gaps that never fail.

Two of those gaps were failing anchors until recently and are reclassified
rather than fixed: Earth's pre-industrial temperature, which is 0.79 K warm and
0.26 K of that is the priced cost of methane's band at its published strength;
and CO₂'s forcing per doubling at high concentration, which falls off where the
real thing strengthens because a semi-grey band saturates all at once. Both
print their numbers on every run.

The biosphere is split between prokaryotes and eukaryotes, in the readout's
**Life** bar. Three conditions decide it, each a fact rather than a knob: oxygen
(the mitochondrion is an oxygen-respiring endosymbiont, so an anoxic world has
no eukaryotes at all), heat (none is known above 60 \u00b0C where prokaryotes reach
122), and CO\u2082 (vascular plants starve at 150 ppm where cyanobacteria manage on a
few). Plus one about history: eukaryogenesis happened once and trailed Earth's
oxygen by ~700 Myr, so oxygenating a world here does not hand it a nucleus in
the same breath. A living Earth reads 86/14 against Bar-On et al. 2018's 85/14,
an Archean one 100% prokaryote, and Earth +2.2 Gyr 100% prokaryote again \u2014 the
star has brightened, weathering has taken the CO\u2082, and the plants are gone.

It reports and does not steer: every preset is bit-identical to seventeen
significant figures with it in.

The brightening mode is a flat 10% a gigayear now. It used to drive Gough
(1981) forwards from an age inferred by inverting it, and that relation has a
pole at 16 Gyr: Young Venus crossed it, was dimmed to the bottom of the slider
and reported "brightening \u221245.3% per Gyr". The starlight slider also
reaches 50 S\u2295 now, because GJ 1132 b receives 18.8 and could not be
represented on one that stopped at 4.

\`carbonDeep\` now means carbon still in the mantle rather than the budget minus
a buffer ratio, which had five presets \u2014 Venus and the Hot Ocean world
among them \u2014 booting with an empty mantle and their volcanoes off. With
that right, outgassing falls as the mantle empties, so a one-way planet no
longer degasses its whole inventory: Young Venus finishes at 130 bar and a dry
runaway rather than 331 bar and a magma ocean.

A far-future magma ocean crawled at 36.6 kyr/s: pO\u2082 was sweeping four
decades as the world went anoxic, and the step controller resolved it to a tenth
of the reservoir per step on a planet with no methane for that to matter to.
1 785 117 steps to cross 3.4 Gyr against 26 276 with the bound gated on the
methane, agreeing to four significant figures.

A wet runaway used to crawl at a couple of kiloyears a second with nothing
happening on it: \`o2Rate\` was missing the oxygen that escaping hydrogen leaves
behind, so the step controller clamped the clock to five-year steps on a world
in a steady balance. Earth at 1.4 S\u2295 crossed 500 Myr in 300 001 steps and
now does it in 884.

The Great Oxidation scenario no longer depends on how fast the clock was
running. It used to snowball pole-to-pole at any step cap above about 20 kyr and
deglaciate into a 128 \u00b0C hothouse on eleven bar of CO\u2082; the quasi-static
shortcut in \`maxStep\` is now off across the ice-albedo bifurcation, and the peak
glaciation agrees to a point from a 2 kyr cap to a 5 Myr one.

A band-overlap refit that closed four more gaps was reverted from this build: it
left a 1.32 S⊕ ocean world with no energy balance at any temperature, which shows
up as cycling in and out of glaciation, and cost fourteen thousand times the
step size on a settled Earth. The README has the full account and there are
three new guards that fail on it.
`);
console.log(`built ${dev}`);
