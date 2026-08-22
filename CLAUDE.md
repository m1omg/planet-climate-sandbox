# Working conventions

## Shipping

**Commit, push and deploy by default, always, unless told otherwise.** Finishing a
change means it is live, not that it is sitting in the working tree. Do not ask
for permission to commit; do not stop at "want me to push?".

GitHub Pages serves `main:/` directly, so `git push origin main` *is* the deploy —
there is no `gh-pages` branch and no build step. Confirm with:

```bash
gh api repos/m1omg/planet-climate-sandbox/pages --jq '.source, .status'
```

After pushing, verify the live site actually took the change rather than assuming
it — Pages caches, and a "built" status is not proof the byte you changed is out
there. Hash-match a file you touched:

```bash
curl -s https://m1omg.github.io/planet-climate-sandbox/src/main.js | sha256sum
sha256sum src/main.js
```

Exceptions, and only these: the user says not to, or the tree is mid-experiment
and known broken. A red check is not an exception — fix it, then ship.

## Before pushing

All eleven checks, every time:

```bash
node src/selftest.js            # physics, coverage, determinism, controls
node tools/calibrate.mjs        # observational anchors + reported known gaps
node tools/smoketest.mjs        # every module against a stub DOM
node tools/glslcheck.mjs
node tools/shadercompile.mjs
node tools/gl1check.mjs
node tools/rendercheck.mjs
node tools/bakecheck.mjs        # slow, minutes
node tools/bodycheck.mjs
node tools/fallbackcheck.mjs
node tools/resumecheck.mjs
```

`calibrate.mjs` matters most: a change that fixes one anchor usually moves three
others. Its yellow `GAP` rows are known deviations that report on every run and
never fail — they exist so that two compensating errors cannot cancel silently.

## How to work on this

- **Write the failing check first.** Prove the old code fails it, then fix, then
  prove it passes. Every bug in the log was caught this way and several
  "obvious" fixes turned out to fix nothing.
- **Verify UI changes in a real browser.** `python3 -m http.server` and drive the
  page. Node tests do not see shader uniforms that are never passed, or readouts
  that read `null` before the first step — both shipped bugs. The DOM stub in
  `smoketest.mjs` does not dispatch events, so behaviour that lives in a click
  handler needs either a browser or a source-level guard.
- **A backgrounded Chrome tab has `document.hidden === true` and rAF frozen.**
  Drive `window.__app.frame(t)` by hand instead of waiting on the clock.
- **Measure before changing.** State the number the model gives now and the number
  it should give, then change one thing.
- **Back up before anything risky.** A dated local copy plus a git tag. Never
  delete an older backup.
- **Revert rather than ship something fragile.** The atmospheric-window model
  passed all anchors and still froze the Archean in 10 kyr; it was reverted and
  the reason written down. That is the expected outcome, not a failure.

## Constraints that do not change

- Must run on a MacBook Air 2017. Optimise, but never at the cost of simulation
  accuracy.
- Do not downscale the JPEG surface maps. Not optimising for dial-up.
- No moralising, no self-flagellating preambles. Report what happened and move on.
