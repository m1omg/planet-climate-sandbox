// Run a build's self-test by section, and in parallel.
//
// Every build's selftest.js is one long function whose blocks are headed
//   // ---- 3c. ice sheets have inertia ...
// and each block is self-contained apart from a handful of worlds settled in
// the first two sections. This runner cuts the file at those headers, keeps
// the preamble (imports and helpers), the sections asked for, and every
// section that declares a name the asked-for ones use -- checked textually,
// so a missing dependency shows up as a ReferenceError naming the section to
// add rather than as a silent pass. Checks in the dependency sections run but
// are not counted, so `--only 7j` reports 7j's checks and nothing else.
//
// With no --only, the sections are dealt across --jobs workers (default: the
// machine's cores), each of which is one such cut of the file, and the totals
// are merged. Nothing about the checks changes: same code, same worlds, same
// numbers, just four processes instead of one.
//
//   node tools/sections.mjs altdev2 --list
//   node tools/sections.mjs altdev2 --only 3c,7j
//   node tools/sections.mjs altdev2                 # everything, in parallel
//   node tools/sections.mjs . --jobs 2
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const build = args.find((a) => !a.startsWith('--')) ?? 'altdev2';
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const list = args.includes('--list');
const only = opt('--only') ? opt('--only').split(',').map((s) => s.trim()).filter(Boolean) : null;
const jobs = Math.max(1, +(opt('--jobs') ?? cpus().length) || 1);
const dir = resolve(root, build, 'src');
const file = join(dir, 'selftest.js');
const src = readFileSync(file, 'utf8');

// ---- cut the file ----------------------------------------------------------
const HEADER = /^  \/\/ ---- ([0-9][0-9a-z-]*)\. /;
const lines = src.split('\n');
const heads = [];
for (let i = 0; i < lines.length; i++) { const m = HEADER.exec(lines[i]); if (m) heads.push({ id: m[1], at: i }); }
if (!heads.length) { console.error(`${file}: no section headers found`); process.exit(2); }
// The summary line closes the last section; everything after it is the tail.
const summaryAt = lines.findIndex((l, i) => i > heads.at(-1).at && /^  const summary = /.test(l));
if (summaryAt < 0) { console.error(`${file}: no summary line after the last section`); process.exit(2); }
const sections = heads.map((h, i) => ({
  id: h.id,
  text: lines.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : summaryAt).join('\n'),
}));
const preamble = lines.slice(0, heads[0].at).join('\n');
const tail = lines.slice(summaryAt).join('\n');

// Names a section declares at function scope (two-space indent), and which
// sections use them. Block-scoped declarations inside `{ ... }` are invisible
// to the others by construction, so only the two-space ones can be shared.
const declared = sections.map((s) => {
  const out = new Set();
  for (const m of s.text.matchAll(/^  (?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  return out;
});
const uses = (s, name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(s.text);
function closure(ids) {
  const want = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of sections) {
      if (!want.has(s.id)) continue;
      sections.forEach((d, j) => {
        if (want.has(d.id)) return;
        for (const name of declared[j]) if (uses(s, name)) { want.add(d.id); grew = true; break; }
      });
    }
  }
  return want;
}

if (list) {
  for (const s of sections) {
    const title = /^  \/\/ ---- [0-9a-z-]+\. (.*?)\s*-*\s*$/.exec(s.text.split('\n')[0])?.[1] ?? '';
    console.log(`${s.id.padEnd(6)} ${title}`);
  }
  process.exit(0);
}

// ---- build one cut and run it ---------------------------------------------
// `check` is patched to count only the sections asked for; the dependency
// sections run silently. A counter line before each section sets the marker.
const patched = preamble.replace(/function check\(name, ok, detail\) \{\n/,
  'function check(name, ok, detail) {\n  if (globalThis.__only && !globalThis.__only.has(globalThis.__sec)) return ok;\n');
if (patched === preamble) { console.error(`${file}: could not find check() to patch`); process.exit(2); }

function cut(ids) {
  const run = closure(ids);
  const body = sections.filter((s) => run.has(s.id))
    .map((s) => `  globalThis.__sec = ${JSON.stringify(s.id)};\n${s.text}`).join('\n');
  return `globalThis.__only = new Set(${JSON.stringify(ids)});\n${patched}\n${body}\n${tail}`;
}

function runCut(ids, label) {
  const tmp = join(dir, `.selftest-${process.pid}-${label}.mjs`);
  writeFileSync(tmp, cut(ids));
  return new Promise((done) => {
    const out = [];
    const child = spawn(process.execPath, [tmp], { cwd: resolve(root, build), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => out.push(d));
    child.on('close', (code) => {
      try { unlinkSync(tmp); } catch { }
      const text = Buffer.concat(out).toString();
      // The browser-console colour markup the self-test prints, stripped.
      const clean = text.replace(/%c/g, '').split('\n').filter((l) => !/^(color:|font-weight:)/.test(l)).join('\n');
      done({ code, text: clean, ids });
    });
  });
}

const known = new Set(sections.map((s) => s.id));
if (only) {
  const bad = only.filter((id) => !known.has(id));
  if (bad.length) { console.error(`unknown section(s): ${bad.join(', ')} -- try --list`); process.exit(2); }
}
const ids = only ?? sections.map((s) => s.id);
const workers = only ? 1 : Math.min(jobs, ids.length);
// Dealt round-robin so the slow early sections and the slow late ones spread.
const deals = Array.from({ length: workers }, (_, k) => ids.filter((_, i) => i % workers === k));
const t0 = Date.now();
const results = await Promise.all(deals.map((d, k) => runCut(d, String(k))));
let pass = 0, fail = 0;
for (const r of results) {
  for (const line of r.text.split('\n')) {
    if (/^(PASS|FAIL)  /.test(line)) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
    else if (/Error|error:|at file:/.test(line)) console.error(line);
  }
  if (r.code !== 0 && !/FAIL  /.test(r.text)) {
    console.error(`worker for sections ${r.ids.join(',')} exited ${r.code} without a verdict -- a ReferenceError above names a section to add to --only`);
    fail++;
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`— ${pass} passed, ${fail} failed — ${build} · ${ids.length} section(s) · ${workers} worker(s) · ${secs} s`);
process.exit(fail ? 1 : 0);
