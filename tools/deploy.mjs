// Place this build into a site root, and prove it touched nothing else.
//
// This branch is not a standalone site and cannot be made into one cheaply.
// index.html sets window.__assetBase to '../assets/' and render/planet.js reads
// the surface maps through it, because the 23 MB of JPEGs at the root of the
// Pages site are shared by every build rather than copied per build. The one
// exception is the Moon map in this branch's own assets/, which belongs to this
// line of work alone. So the deployed shape is fixed: these files go one level
// below a root that already has assets/bodies/ in it, and that is also the only
// shape the check suite runs in -- smoketest and glslcheck resolve '../assets/'
// exactly as the browser does, and fail on paths anywhere else.
//
// Hence a tool rather than a cp -r. The site root is a checkout of main, which
// carries three other builds and someone else's work in progress, and the
// standing rule on it is that nothing outside this build's own directory may
// move. That is not a promise worth making by hand: every file outside the
// destination is hashed before and after, and a single changed byte stops the
// run. The copy is also a sync rather than an overlay -- a file that stops
// being tracked here is deleted there -- so a rename cannot leave the old name
// behind to be served as a stale module.
//
//   node tools/deploy.mjs <site-root> [--dry-run]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEST = 'altdev2';
const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const siteArg = args.find((a) => !a.startsWith('--'));
if (!siteArg) {
  console.error('usage: node tools/deploy.mjs <site-root> [--dry-run]\n'
    + '  <site-root> is a checkout of the Pages site -- the directory holding\n'
    + '  index.html and the shared assets/bodies/ that this build reads through\n'
    + `  ../assets/. This build is written to <site-root>/${DEST}/.`);
  process.exit(2);
}
const site = resolve(siteArg);

// A typo here would scatter sixty files into somewhere that is not the site, so
// establish that the destination really is one before writing anything: the
// shared map set is the thing this build exists one level below, and its
// absence means the path is wrong however plausible it looks.
if (!existsSync(join(site, 'assets/bodies/earth.jpg'))) {
  console.error(`not a site root: ${site}\n  expected assets/bodies/earth.jpg -- the shared map set this build reads`);
  process.exit(2);
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
const tracked = (cwd) => git(cwd, 'ls-files', '-z').split('\0').filter(Boolean);
// Untracked files count too, and finding that out took a deliberate attempt to
// break this: a sabotaged copy of this tool, pointed at a throwaway site root,
// was caught clobbering index.html and got clean away with dropping a whole
// src/ and css/ beside it. Both are equally wrong -- serving files the site
// never asked for is as much a change to it as editing one -- and only the
// first was visible, because ls-files lists what git is tracking and a file
// created a moment ago is not that yet.
const present = (cwd) => [...tracked(cwd),
  ...git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)];
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

// The invariant, measured rather than asserted: every file in the site that is
// not part of this build, hashed. The comparison at the end is against this
// exact map, so a file appearing or vanishing counts as a change too.
const outside = () => {
  const map = new Map();
  for (const f of present(site)) {
    if (f === DEST || f.startsWith(`${DEST}/`)) continue;
    const p = join(site, f);
    // A tracked file the working tree no longer has is already missing, and
    // recording that state is the point -- it has to be just as missing after.
    map.set(f, existsSync(p) ? hash(p) : null);
  }
  return map;
};

const before = outside();
console.log(`site: ${site}`);
console.log(`guarding ${before.size} files outside ${DEST}/`);

// What this build consists of: tracked files, working-tree contents. Tracked so
// that scratch files, editor droppings and node_modules cannot ride along;
// working-tree contents so an uncommitted change can be tried in a browser
// before it is committed.
const want = new Set(tracked(here));
const destRoot = join(site, DEST);

// Anything under the destination that this build no longer tracks: stale, and
// deleted rather than left. Read from git rather than the filesystem so that an
// untracked file someone deliberately dropped in there is left alone.
const have = existsSync(destRoot)
  ? tracked(site).filter((f) => f.startsWith(`${DEST}/`)).map((f) => f.slice(DEST.length + 1))
  : [];
const stale = have.filter((f) => !want.has(f));

let written = 0, unchanged = 0;
for (const f of want) {
  const src = join(here, f);
  const dst = join(destRoot, f);
  if (existsSync(dst) && statSync(dst).size === statSync(src).size && hash(dst) === hash(src)) {
    unchanged++;
    continue;
  }
  written++;
  if (dryRun) continue;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}
for (const f of stale) {
  if (dryRun) continue;
  rmSync(join(destRoot, f), { force: true });
}

console.log(`${DEST}/: ${written} written, ${unchanged} unchanged, ${stale.length} stale removed`
  + (dryRun ? '  (dry run -- nothing was written)' : ''));
if (stale.length) console.log(`  removed: ${stale.join(', ')}`);

// The guard. Not a formality: the site root holds the stable build, /dev/, and
// /altdev/, which is another line of work in progress by someone else.
//
// A tripwire rather than a lock -- it reports after the fact, because there is
// no cheap way to make a copy transactional. That is enough, and it is enough
// for a specific reason: the destination is a git checkout, so anything this
// reports is recoverable there as long as it is not committed. Which is why the
// failure says so rather than only complaining.
const after = outside();
const moved = [];
for (const [f, h] of before) if (!after.has(f) || after.get(f) !== h) moved.push(f);
for (const f of after.keys()) if (!before.has(f)) moved.push(`${f} (new)`);
if (moved.length) {
  console.log(`\x1b[31mFAIL\x1b[0m  ${moved.length} file(s) outside ${DEST}/ changed:\n  `
    + moved.join('\n  '));
  console.log(`\nDo not commit ${site} until this is undone. Nothing here has been\n`
    + 'committed, so `git checkout -- <path>` restores a tracked file and `git clean`\n'
    + 'removes an added one. Then work out why this tool wrote there before rerunning it.');
  process.exit(1);
}
console.log(`\x1b[32mPASS\x1b[0m  every file outside ${DEST}/ is byte-identical`);
