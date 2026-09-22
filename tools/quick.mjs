// The checks a change actually needs, from what git says changed.
//
// The full suite of a build is twenty minutes of gigayear runs, and most edits
// touch one module. This reads the working tree's diff against HEAD (or the
// commits named in --since), maps each changed file to the checks that read it,
// and runs those. The map is written down here, in the repository, so that
// "quick" means "the checks for this file" and not "the ones somebody
// remembered" -- and anything not in the map runs the build's whole suite,
// which is the safe answer for a file nobody has classified.
//
// It is the gate BEFORE a push, not instead of one: the full suite still runs
// on every push to main (.github/workflows/checks.yml) and in tools/sections.mjs
// across all cores when you want it locally.
//
//   node tools/quick.mjs                  # working tree against HEAD
//   node tools/quick.mjs --since HEAD~2   # the last two commits too
//   node tools/quick.mjs --dry            # say what would run
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : 'HEAD';
const dry = args.includes('--dry');

const changed = execFileSync('git', ['diff', '--name-only', since, '--'], { cwd: root, encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean);
// The section runner's temporary cuts are not changes.
const files = [...new Set([...changed, ...untracked])].filter((f) => !/\/\.selftest-\d+-/.test(f));
if (!files.length) { console.log('nothing changed'); process.exit(0); }

// Which build a path belongs to, and the path inside it.
const BUILDS = ['altdev2', 'altdev', 'dev'];
function split(path) {
  for (const b of BUILDS) if (path.startsWith(b + '/')) return { build: b, rel: path.slice(b.length + 1) };
  return { build: '.', rel: path };
}

// A check is [command, args...] run from the build's directory. `sections`
// runs named sections of that build's self-test through tools/sections.mjs;
// `all` is the whole self-test in parallel.
const sections = (...ids) => ({ kind: 'sections', ids });
const ALL = { kind: 'sections', ids: null };
const tool = (name) => ({ kind: 'tool', name });
const gpu = (name) => ({ kind: 'gpu', name });

// The map. Keys are regular expressions on the path inside the build; a file
// matching several gets the union. Section ids are the headers in selftest.js
// (`node tools/sections.mjs <build> --list`). Physics files run the whole
// self-test because every section builds worlds on them; the point of the map
// is everything that is NOT physics.
const MAP = [
  [/^src\/physics\/(radiation|climate|volatiles|ocean|waterworld|evolution|hypsometry|planet|biosphere|constants)\.js$/,
    [ALL, tool('calibrate'), tool('phasecheck'), tool('handoffcheck'), tool('statuscheck')]],
  // The drawn column's density and boiling point: read only by the cross-section.
  [/^src\/physics\/watereos(-table)?\.js$/, [sections('3c', '7i', '7i2'), tool('structurecheck'),
    tool('phasecheck'), tool('buriedcheck'), tool('smoketest')]],
  [/^src\/physics\/classify\.js$/, [ALL, tool('phasecheck'), tool('statuscheck'), tool('buriedcheck'), tool('waterworldcheck')]],
  [/^src\/physics\/surface\.js$/, [sections('7', '7e', '7f'), tool('historycheck'), tool('reviewcheck')]],
  [/^src\/sim\/clock\.js$/, [sections('7', '7d', '7e', '7f', '3o1z'), tool('smoketest'), tool('scenariocheck'), tool('resumecheck')]],
  [/^src\/game\/scenarios\.js$/, [tool('scenariocheck'), sections('7d'), tool('smoketest')]],
  [/^src\/game\/(snapshot|validation|storage)\.js$/, [sections('7d', '7e', '7f'), tool('statuscheck'), tool('smoketest')]],
  [/^src\/game\/presets\.js$/, [ALL, tool('calibrate'), tool('smoketest')]],
  [/^src\/game\/controls\.js$/, [sections('8'), tool('smoketest')]],
  [/^src\/game\/sk\.js$/, [sections('8', '9'), tool('smoketest')]],
  [/^src\/main\.js$/, [tool('smoketest'), tool('statuscheck')]],
  [/^src\/render\/glsl\//, [tool('glslcheck'), gpu('shadercompile'), gpu('gl1check'), gpu('bodycheck'), gpu('bakecheck')]],
  [/^src\/render\/(planet|shaders)\.js$/, [tool('glslcheck'), gpu('shadercompile'), gpu('gl1check'), gpu('bodycheck'), tool('rendercheck'), tool('resumecheck')]],
  [/^src\/render\/(software|cpushade|terrain)\.js$/, [tool('fallbackcheck'), tool('rendercheck'), gpu('bakecheck'), gpu('bodycheck')]],
  [/^src\/render\/(charts|atmosphere|camera)\.js$/, [tool('smoketest'), tool('historycheck'), tool('reviewcheck')]],
  [/^src\/selftest\.js$/, [ALL]],
  // A tool that is a check runs itself; the rest of tools/ (benchmarks,
  // probes, the asset builder, this file) are not checks and run nothing.
  [/^tools\/(\w+)\.mjs$/, 'self'],
  [/^(index\.html|css\/)/, [tool('smoketest')]],
  [/\.(md|txt)$/, []],
  [/^assets\//, [gpu('bodycheck')]],
];

const NOT_CHECKS = new Set(['quick', 'sections', 'bench', 'throughput', 'track', 'convergence',
  'inneredge', 'deploy', 'buriedprobe', 'buriedconvergence', 'identity', 'browsercheck']);
const plan = new Map();   // build -> Map(key -> check)
const add = (build, c) => {
  const key = c.kind === 'sections' ? `sections:${c.ids ? c.ids.join(',') : 'all'}` : `${c.kind}:${c.name}`;
  if (!plan.has(build)) plan.set(build, new Map());
  plan.get(build).set(key, c);
};
const unmapped = [];
for (const f of files) {
  const { build, rel } = split(f);
  let hit = false;
  for (const [re, checks] of MAP) {
    const m = re.exec(rel);
    if (!m) continue;
    hit = true;
    if (checks === 'self') { if (!NOT_CHECKS.has(m[1])) add(build, tool(m[1])); continue; }
    for (const c of checks) add(build, c);
  }
  if (!hit) { unmapped.push(f); add(build, ALL); }
}
// Whole-suite requests subsume section requests; section requests merge.
for (const [build, checks] of plan) {
  if ([...checks.values()].some((c) => c.kind === 'sections' && !c.ids)) {
    for (const k of [...checks.keys()]) if (k.startsWith('sections:') && k !== 'sections:all') checks.delete(k);
  } else {
    const secs = [...checks.values()].filter((c) => c.kind === 'sections');
    if (secs.length > 1) {
      for (const k of [...checks.keys()]) if (k.startsWith('sections:')) checks.delete(k);
      add(build, sections(...new Set(secs.flatMap((c) => c.ids))));
    }
  }
}

console.log(`changed: ${files.join(', ')}`);
if (unmapped.length) console.log(`not in the map, so the whole suite runs for their build: ${unmapped.join(', ')}`);
let failed = 0;
for (const [build, checks] of plan) {
  const dir = resolve(root, build);
  for (const c of checks.values()) {
    let cmd, cargs, cwd = dir;
    if (c.kind === 'sections') {
      cmd = process.execPath; cwd = root;
      cargs = [resolve(root, 'tools/sections.mjs'), build, ...(c.ids ? ['--only', c.ids.join(',')] : [])];
      if (!existsSync(resolve(dir, 'src/selftest.js'))) continue;
    } else {
      const script = resolve(dir, `tools/${c.name}.mjs`);
      if (!existsSync(script)) continue;   // not every build has every tool
      cmd = c.kind === 'gpu' && process.platform === 'linux' && !process.env.DISPLAY ? 'xvfb-run' : process.execPath;
      cargs = cmd === 'xvfb-run' ? ['-a', process.execPath, script] : [script];
    }
    const label = `${build === '.' ? 'root' : build}: ${c.kind === 'sections' ? (c.ids ? 'self-test ' + c.ids.join(',') : 'self-test (all, parallel)') : c.name}`;
    console.log(`\n== ${label}`);
    if (dry) continue;
    const r = spawnSync(cmd, cargs, { cwd, stdio: 'inherit' });
    if (r.status !== 0) { failed++; console.log(`== ${label}: FAILED (exit ${r.status})`); }
  }
}
console.log(failed ? `\n— ${failed} check(s) failed —` : '\n— quick gate passed —');
process.exit(failed ? 1 : 0);
