# Review fixes — September 2026

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
