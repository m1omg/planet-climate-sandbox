# Review fixes — September 2026

## September 22, second push: the shared fixes, ported

The defects the status check found in more than one build, fixed in the root,
`altdev` and `dev` builds the way altdev2 already has them.

- **A save carries the step chooser's memory.** `captureWorld` dropped the
  last step and the smoothed rates the step bound reads, and `resetWorld`
  never cleared them, so a restored world took a first step 1.8× the one it
  was taking and a preset loaded after a runaway started from the runaway's
  escape flux. Each build's round-trip test now has a free-step twin (the
  capped one could not see it): root and altdev were 0.05 K and 0.03 K off
  their own trajectory 700 kyr later; identical now. `validation.js` lists
  `weathering` and `lifeRoom` as bags only, not as scalars too.
- **The clock keeps its time at a low frame rate** (root, altdev): the credit
  clamp follows the observed frame cost instead of a flat tenth of a second,
  and the "running as fast as it can" readout divides by the frame's own
  seconds instead of the readout's period (six times low at 60 Hz). Settle no
  longer adds a history sample every frame on top of the step's own rule.
- **The star moves on the simulated clock** (dev): brightening and easing were
  applied from the readout ten times a real second, a thirty-megayear
  staircase at the top of the rate slider; they are a per-step drive now, the
  same hook the scenarios use, and the readout only shows the value.
- **The rate field** (altdev) no longer commits the throttled number it was
  only displaying when it is focused and blurred untouched.
- **Root**: the scrub preview keeps the future in the temperature chart (the
  water chart already did); the cloud bake declares the seed it was always
  handed, so worlds get their own cloud decks; the software renderer asks
  what is alive before drawing forests; `mantleInfinite` is a preset field and
  its checkbox follows the world; a scenario clears the body map; the star
  temperature and starlight sliders cover every preset (2566 K, 18.8 S⊕);
  the discovered-climates total reads 20 (22 in dev and altdev) before the
  script corrects it.
- **Slovak** for altdev's outgassing chips; altdev's `browsercheck.mjs` passes
  `--no-sandbox` only as root, like altdev2's.
- **dev/README** no longer names a build script and a branch that do not
  exist; dev has no calibration run of its own and says so.
- **Repository**: the six unreferenced PNG textures (17 MB; the renderers load
  the JPEGs) and the unreferenced `earth_height.jpg` are gone. Not a
  downscale — the JPEG surface maps are untouched.

Verification: root **205 self-tests, 0 failed**, 21 anchors + 3 gaps,
smoketest 24, glslcheck, shadercompile, gl1check, bodycheck, bakecheck under
Xvfb, rendercheck, fallbackcheck, resumecheck, historycheck, reviewcheck;
altdev self-test and calibrate (23 + 3), smoketest 30, the same GPU tools;
dev **250 passed, 17 standing failures — the same seventeen as before**;
altdev2 smoketest and statuscheck after its validation change; headless
Chromium sweeps of the root, dev and altdev presets with no console errors.

## September 22: altdev2 — the water column, the scenarios, the saves, a builder

Everything reported from play against the paper the buried ocean is built on
(Pierrehumbert 2023, arXiv:2212.02644), each written as a failing check first.
Detail in `altdev2/WATERWORLDS.md`, "what a lid is, and what melts".

- **The state chain.** Buried Ocean requires a lid — a hot target over the
  pool, the paper's cold start — and Earth at 2.6 S⊕ no longer reads Buried
  Ocean while 99% of its sea is still liquid under no lid. Steam Runaway is
  a sea going into the sky (past the runaway limit with a tenth airborne, or
  air more than half water); the 431 K world with 0.0008% airborne reads Moist.
  Supercritical Ocean stays open to hydrogen-free worlds (the paper's terminal
  state applies to terrestrial planets) and needs the critical pressure too.
  The two self-tests HEAD shipped red are re-specified to this: the envelope-
  free list holds the two Hycean states; the 2.6 S⊕ path is temperate → moist →
  steam runaway → supercritical. Earth's Last Ocean is never buried (its sea
  boils through its surface); the burial tests use sixty oceans, buried 3 Myr.
- **A pool is made of what has not evaporated**: `coldPoolStructure` is capped
  by the condensed reservoir, so the same water is never in the sky and in a
  pool at once. The Venus display checks plant a condensed pool under a lid.
- **Melting is paid for**: the cold pool's budget charges the latent heat of
  the ice VI/VII that went over the last step (`L_FUSION_HP`); the floor used
  to retreat at twice what the energy reaching it allows. Relabelling the
  hot melt "ocean" was tried and reverted: above 647 K it is the paper's
  supercritical interior.
- **A supercritical layer needs supercritical conditions**: the drawn band
  needs 647 K and 220.6 bar, and `hotLayer` recondenses on the overturning
  timescale once the surface is below the critical point with no target left.
  The step bound uses the retreat flux, so a cooling transit is walked.
- **An ice edge is stepped through**: the band ice at the end of the last
  step bounds the next step by the edge's speed and cuts the quasi-static
  shortcut to 46× while the edge is live. The reported world's 102 crossings
  in 60 Myr are 7; its ~20 Myr weathering cycle is real and kept.
- **The low-gravity handoff** blends escape, the runaway margin and the state
  name by the overlap weight instead of switching on it being non-zero. The
  closures' disagreement (a 78 K ramp between 0.12 and 0.30 M⊕) is a new
  calibrate GAP row; `tools/handoffcheck.mjs` holds the gates.
- **Scenarios** are decided per step (main.js `scenarioStep`), so a verdict
  lands at the same year at any frame rate; each carries a measured
  `solution`, and `tools/scenariocheck.mjs` plays every one three ways. Dune
  (unwinnable at 1.5) and the Eyeball (won by waiting) open stable and walk
  the star to their threat; Hold, Venus and the Hot Ocean say what actually
  works, with the numbers read off this build.
- **Saves**: the two-click "click again to overwrite" latch is gone; a slot
  picked while armed saves at once. Salinity's domain matches its slider.
  History thins instead of dropping its first half, so a rewind to the start
  no longer wipes the epochs; the scrub preview keeps the future in both charts.
- **Clock**: the frame clamp follows the observed frame cost, so 5 fps keeps
  its time (was half); the achieved-rate readout divides by the frame's own
  seconds (was 6× low at 60 Hz).
- **The sluggish heating worlds** (reported: Earth's Last Ocean and others
  warming with their carbon gone): the CO₂ step bound rationed the step
  against a change a pinned reservoir cannot make — 0.1 ppm with weathering
  four times the supply — and held that world at 420-year steps for its whole
  run, 400 000 steps where the accuracy step allowed a megayear. Pinned worlds
  are exempt now, as the oxygen bound already exempted them: 44 000 steps,
  nine times faster, and the tipping date converged at 129–133 Myr from
  500-year steps to free ones.
- **The carbon seal reads the ice that is there.** `sealFactor` read the
  SEA's column for the ice VI/VII a volcano's CO₂ has to cross, and the sea is
  the water that still has a surface: under a closed lid there was none, the
  seal opened, and thirty bar of CO₂ came up through 230 km of ice. Before
  the column fix it read the same water divided by a flooded fraction on its
  way to zero — 243 000 km of ice — and sat on its floor. The Cold-Start
  Runaway was 1770 K or 1417 K at ten megayears by which wrong column it read.
  The seal, the melt charge and the deep-ice bookkeeping now share one number,
  `iceDeep`, solved purely once a kiloyear over the basin or under the pool
  (191 km, seal 0.25). `phasecheck.mjs` holds it.
- **The hydrogen-background gate is a ramp.** Convective inhibition switched
  off at a hydrogen dry share of one half, as a step: volcanic CO₂ under an
  18 bar envelope took the share through it at 18 bar, and the outgoing flux
  tripled between 17.99 and 18.01 bar on a 1550 K world, which fell 260 K in
  one step and sat pinned at the pressure where the flux jumped. It ramps
  from a quarter to a half now; nothing above a half share changes. The cold
  start reads 1465 K at ten megayears, converged. A self-test scans the gate.
- **Planet builder**: "Build a planet" in Worlds loads a bare rock paused and
  walks Body → Star → Atmosphere → Surface, folding the rest; every control
  stays live. Blank preset `blank`, Slovak throughout.
- **Slovak** for the outgassing chips, the four menu hints and every toast
  (`toast()` translates at source).

Verification: altdev2 **412 self-tests, 0 failed**; calibrate **35 anchors,
13 known gaps**; smoketest 33 modules; statuscheck 17; phasecheck; handoffcheck;
scenariocheck; buriedcheck, waterworldcheck, mixedwatercheck, structurecheck,
venusdisplaycheck, venuspaintcheck; glslcheck, shadercompile, gl1check,
bodycheck, bakecheck under Xvfb with headless-gl; rendercheck, fallbackcheck,
resumecheck; root historycheck and reviewcheck; identity diff moves only the
ice-edge worlds by millikelvins, the deep-ice worlds by the seal's kiloyear
sampling, and the cold start; headless Chromium drives
of all 40 presets, all 8 scenarios and the builder, no console errors;
browsercheck.mjs 28 passes to its documented GPU-less timeout.

## September 21 Venus display and history follow-up

- Reject thermally remembered buried liquid when its proposed temperature and
  overlying pressure cannot support liquid water. The reported Early Venus
  state had all of its tracked water in vapour; its 327 m ocean was spurious.
- Render physically supported shallow buried pools using the existing basin
  coverage law. Classification, Structure and surface-temperature selection
  share the corrected liquid diagnostic.
- Record temperature changes of at least 2 K between scheduled history samples
  and include the live state at the chart endpoint, including paused edits.
  The history fix applies to all four builds. Previously saved samples retain
  their recorded values.
- Focused validation: four Venus display/phase checks, four cross-build history
  checks, the software-renderer/chart check, and 36 review checks pass. The
  renderer distinguishes the valid pool from dry ground in 13,690 pixels.
- The integrated physical states of all 39 altdev2 presets match the preceding
  version in the bounded comparison. Stable has 204 passing self-tests and
  21 calibration anchors; altdev2 has 35 passing anchors (12 known model gaps).
  All eleven stable pre-push checks completed, with the three optional GPU
  checks skipped because headless GL is unavailable. Browser discovery returned
  no available browser, so interactive layout verification remains unavailable.
- The full `altdev2` suite passes all 410 checks, including the 19-preset
  fast/exact comparison. The full `altdev` suite passes all 302 checks.
- The full experimental `dev` suite reports 249 passed and 17 failed in both
  the changed version and a clean pre-change baseline; every failure detail
  matches. These existing failures remain visible and are not new regressions.

## September 21 continuation

- Save validation now drops invalid numeric nulls while preserving structured
  `weathering` and `lifeRoom` runtime state in all four builds. Exact JSON
  round-trip and continuation checks cover the shared repair. Altdev also
  preserves an unset sunlight-transition rate rather than changing it to null.
- Altdev/altdev2 clear epochs and milestones at reset/preset/scenario creation,
  before taking the new world's first restore point. Altdev2 clears its pending
  epoch candidate on restore/rewind too; sub-year starts cannot mix two runs.
- Altdev2's former hard mass/spectrum/water-depth model gates are replaced by
  documented smooth overlap weights, consistently applied to energy fluxes,
  humidity, escape and damping. This numerical interpolation is not claimed
  as a quantitatively validated unified atmospheric model.
- Altdev2 retains physically motivated water-rich interiors. Tests protect
  inherited rocky presets without incorrectly banning ice mantles from moons.
  The shell salinity offset and missing cold high-pressure ice floor were
  corrected. Callisto's preset heat flux is explicitly an assumed 4 mW/m²
  ocean-bearing scenario; low-heat custom worlds are not forced to have oceans.

See [the detailed model assumptions](altdev2/WATERWORLDS.md). Earlier verification
entries below describe their dated runs, not the latest validation.

Latest results: altdev2 **410 self-tests, 0 failures**, **35 calibration anchors**
(12 known gaps); root **204 self-tests**, **21 anchors** (3 known gaps).
The **36 cross-build review checks** and **17 new status regressions** pass,
as do the waterworld, mixed-atmosphere, structure, shader-parser, CPU-render,
bake and fallback/resume checks. Interactive browser verification was unavailable;
optional real-GPU checks were skipped without headless GL.

Applied to main (`src/`), `dev/`, `altdev/`, and `altdev2/` where applicable:

- Imported save names are escaped before insertion into slot HTML.
- Save restoration closes the previous scenario before loading another world.
- URL defaults match the actual Earth startup preset. Numeric and boolean
  inputs are type checked, non-finite/invalid physical values are discarded,
  and save/runtime fields pass through the same validation layer. Malformed
  fields fall back to defaults rather than poisoning the simulation.
- Loading a partial save starts with known defaults, not leftovers from the
  previously selected planet. Local-storage saves receive the same validation
  as file imports.
- Restored history begins with a sample of the restored state, not a spurious
  year-zero sample. History water pressure and albedo use the actual diagnostic
  quantities, rather than other atmospheric gases or absorbed fraction.
- Both altdev builds preserve smooth-sun transitions in snapshots and put the
  **current** sunlight in shared URLs, even while returning toward the default.
- History dragging previews preserve future milestones and epochs. Only
  committing the rewind truncates the abandoned future.
- Tool entry points handle accented/space-containing paths. GLSL-parser lookup
  uses portable local/global paths and supports `NODE_PATH` explicitly.
- Schema completeness also preserves dev's spent-carbon setting and the alt
  builds' tidal-heating parameter in saves and URLs.

`node tools/reviewcheck.mjs` runs the focused cross-build regression checks.
The physics extension is confined to altdev2; see
[its model notes](altdev2/WATERWORLDS.md).

These changes were prepared in an extracted project and then transferred to a
fresh Git checkout for publication. All existing destination files matched the
pre-edit backup; no upstream changes had to be overwritten or discarded.

## Verification

- Cross-build review regressions: **30 passed**.
- Dedicated altdev2 waterworld checks: **10 passed**.
- Compatibility: **94 existing presets** compared with the pre-edit backup,
  200 adaptive steps each; temperatures, water reservoirs and clocks were
  bit-identical. This is a bounded regression comparison, not proof of all
  long-term trajectories.
- Main self-tests: **204 passed, 0 failed**.
- Dev self-tests: **249 passed, 17 failed**, matching the pre-existing review
  result. These concern that experimental build's different physics/calibration;
  they were not removed or relabelled to make this repair green.
- Altdev full self-tests: **299 passing checks before the 15-minute limit**;
  altdev2: **99 passing checks before that limit**. Neither is claimed as a
  completed full-suite pass.
- Main/altdev/altdev2 module/UI-stub smoke checks passed. Latest altdev2 smoke
  run loaded **32 modules, 0 failures**, including controls and translations.
- Main calibration: **21 anchors passed**, 3 reported known model gaps.
  Altdev calibration: **23 anchors passed**, the same 3 known gaps.
  Altdev2 calibration did not finish within the bounded validation run.
- GLSL grammar checks and CPU renderer entry points passed for all three tool
  sets, including this accented checkout path. Explicit `NODE_PATH` parser
  lookup was also checked with the default Node interpreter.
- Actual GPU shader/GL1/body-map tests reported **skipped**: headless GL is not
  installed. No browser was available through the browser connection, so
  interactive visual verification remains outstanding.
- CPU fallback and simulated context-loss/resume checks passed in main,
  altdev and altdev2. Full-resolution CPU bake checks passed in both altdev
  builds. The main bake check initially hit its 120-second limit, then passed
  in the clean publication checkout with a longer allowance. All eleven main
  pre-push commands completed there: 204 self-tests passed, with GPU checks
  explicitly skipped for the missing headless-GL dependency.

The pre-edit source backup is
`/tmp/planet-climate-before-fixes-GmDL1L/source.tar.gz`; temporary-directory
backups may be removed by the operating system. No user source was deleted.
