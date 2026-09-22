# Small waterworlds (altdev2 only)

### September 22: the boundary under a lid, by phase

Between a lid and the pool is a conductive layer carrying the mixed-down flux,
δ = k·ΔT/F. It was drawn as liquid from the surface temperature down, which
put 384 °C water under 198 bar (it boils at 365) and 985 °C "liquid" under 557
bar. A liquid surface cannot be hotter than its boiling point at the pressure
on it, and past 220.6 bar there is no surface at all. So the layer is drawn in
the phases it is in: **steam** from the surface to the boiling point when the
pressure is under critical, **supercritical fluid** down to 374 °C when it is
over, then **liquid** to the pool. Each part carries the same flux with its own
conductivity (steam and supercritical fluid ~0.05–0.5 W/m/K by temperature and
density, fitted to IAPWS 2011 within ~20%; liquid 0.6), and each is weighed
with IAPWS-95 density, tabulated by `tools/watereos.py`. The boiling point is
taken at the total pressure: that is the limit past which the water boils,
whatever share of the sky is hydrogen.

### September 21, later: what a lid is, and what melts

Four faults reported from play, all in the water column, all fixed against the
same reference — Pierrehumbert 2023, *The runaway greenhouse on subNeptune
waterworlds* (arXiv:2212.02644) — and each written as a failing check first
(`node tools/phasecheck.mjs`, `node tools/handoffcheck.mjs`).

**A lid is the cold-start case.** The paper's §4: a world that condensed an
interior and then crossed the runaway threshold heats its atmosphere to the
depth sunlight reaches, and with nothing driving convection below, a hot
(possibly supercritical) isothermal layer sits on a cold liquid or ice boundary
and advances downward by evaporating what it touches. `dg.lidded` is that
layer — a hot target over the pool — and the lid is *hotter* than the water
under it. **Buried Ocean now requires it.** An ordinary runaway (Earth at
2.6 S⊕, 415 K, 99% of the ocean still liquid, no hot target) is not buried:
its sea is leaving through its own surface, and it reads Steam Runaway from
the moment the world is past its runaway limit with a tenth of the water
airborne, or the air is more than half water, until the surface passes the
critical point. Its sequence is temperate → moist → steam runaway →
supercritical, as the paper has it for terrestrial planets — with one
ninety-year Buried Ocean between the lid closing and the last half-kilometre
of sea boiling under it, kept because the cross-section draws that pool and
the name must not contradict the picture. Earth's Last Ocean, one ocean deep,
is therefore never buried; sixty oceans under the same brightening Sun are
buried for three megayears, and the self-tests measure that world now.

**A pool is made of what has not evaporated.** `coldPoolStructure` is capped
by the condensed reservoir (`dg.condensedWater`: ocean, sea ice, land ice).
The unconverted share of `hotLayer` is a thermal memory written for a
stratified column hundreds of kilometres deep; on Earth's it read most of an
ocean as a cold pool under a sky that held the same water.

**Melting is paid for.** Reported as "the high-pressure ice does not melt,
it becomes supercritical": it does melt, and on a pool whose top is past
~500 K what it melts into is fluid hotter than 647 K along the adiabat, which
is the supercritical interior of the paper (and of Mousis et al. 2020) by its
own name. Relabelling that fluid "ocean" because it sits in the ice VI field
was tried and reverted. What was wrong is that the melt cost nothing: the
pool's energy budget charged sensible heat only, so 1250 km of ice VII went in
four megayears on energy that pays for half of it. Melting the floor is now
charged its latent heat (`L_FUSION_HP`, 250 kJ/kg, the low end of the ice
VI/VII literature) against the mixed-down flux, per square metre of planet.

**A supercritical layer needs supercritical conditions.** The drawn band
required only `hotLayer > 0` and took the surface temperature verbatim, which
is how a world cooled to −228 °C was drawn with 35 km of "supercritical" over
its ocean and lost its ice shell from the picture. The band now needs
`T ≥ 647 K` and `p ≥ 220.6 bar` like every other use of the word, and the
layer itself recondenses: with no hot target and the surface below the critical
point, `hotLayer` relaxes to zero on the overturning timescale
(`RECONDENSE_YEARS`, 10⁴ yr) rather than on the fifth of a watt a frozen
planet radiates. The step bound uses the retreat flux while the layer
retreats, so a cooling transit can no longer be stepped over in one go.

**An ice edge is stepped through.** Near the outer edge the quasi-static
shortcut multiplied the step 4000× at the moment the world reached its warm
branch, and the explicit albedo update landed it back on the cold one: 102
crossings of the half-ice line in 60 Myr against 4 at a 1 kyr step. The band
ice at the end of the last step (`iceMeanPrev`, `iceMeanLast`) now bounds the
next step by the edge's speed and cuts the shortcut to 46× while the edge is
live, on any world. The slow ~20 Myr swing that remains on that world — CO₂
building while it is frozen, drawing down while it is warm — is the
weathering limit cycle and is kept.

**The carbon seal reads the ice that is there.** Fixing the sea's column
(the water still under a sea surface, over the area that still has one)
moved the Cold-Start Runaway from 1770 K to 1417 K at ten megayears, and both
numbers were wrong. `sealFactor` — how much volcanic CO₂ crosses the ice
VI/VII floor to the air — read that column's ice depth. Before the fix the
column was the whole inventory divided by a flooded fraction on its way to
zero: 243 000 km of ice, seal on its floor. After it the sea under a closed
lid was empty: zero ice, seal open, thirty bar of CO₂ up through 230 km of
ice VII. The seal, the melt charge and the deep-ice bookkeeping now share
one number, `iceDeep`: solved purely once a kiloyear, under the pool when
there is a lid and over the basin extent when there is not, 191 km on that
world and a seal of 0.25 either side of the lid closing. The same run then
found a cliff in the radiation: convective inhibition switched off as a
step when hydrogen's share of the dry air fell through a half, and the CO₂
accumulating under the 18 bar envelope took it through at 18 bar — the
outgoing flux tripled between 17.99 and 18.01 bar, the world fell 260 K in
one step and sat pinned at the pressure where the flux had jumped. The gate
ramps from a quarter share to a half now (`INH_MIXED`); nothing above a
half share changes, and the cold start reads 1465 K at ten megayears.

**A lid does not need the critical point, and a lid over ice is the end.**
Reported from play as two screenshots of one world: a 212 °C steam sky over
a 23 °C stratified sea reading Steam Runaway, and the same world four
megayears later — supercritical fluid on three thousand kilometres of ice
VII, its last liquid gone — reading Steam Runaway again. The lid test was
the critical point, so the paper's cold start at sub-critical temperature was
not a lid; and Supercritical Ocean waited for the hot layer to convert a
column that is mostly ice it eats through by conduction over gigayears.
`dg.lidded` now also names the thermal lid: a sky more than half water
(`LID_STEAM`), a surface `LID_JUMP` (100 K) above the pool, and more water
than a sky can take (`LID_MIN_BAR`, 1000 bar, four Earth oceans — a bound,
not a measurement, chosen so that Earth's own sea, which does leave through
its surface, keeps reading as the steam runaway it is). Supercritical Ocean
is reached when the conversion finishes OR when nothing liquid is left under
the lid. And the melt film is drawn: between fluid at 900 °C and ice VII at
50 °C there is water below the critical temperature, the conductive layer
carrying the mixed-down flux, k·ΔT/F, tens to hundreds of metres, sitting on
the ice because it is denser than the fluid above. `phasecheck.mjs` case 5
holds all three on that world at 1 and 5 Myr.

**The handoff to the standard band model** (`waterworld.js`) blends the
energy fluxes by its overlap weight, but the escape path, the runaway margin
and the state name switched on the weight merely being non-zero: 3e-23 to
1e-7 oceans a year of escape across 0.005 M⊕, Infinity to a number for the
margin. All three now follow the weight. What remains is the closures'
disagreement — on a gas-free steam world at 0.98 S⊕ the low-gravity closure
settles warm and the band model freezes, so the blended balance loses its warm
equilibrium near a weight of 0.9 and the world drops ~40 K in a step somewhere
on each ramp. Water self-broadening (×5 on the water term) was tried and moved
the cold end by five kelvin while putting four calibration anchors off, so the
gap is the band model's ice-albedo feedback under a thin sky, not its
broadening. It is reported every run as a `GAP` row by `calibrate.mjs` and
measured by `handoffcheck.mjs`; nothing is tuned to hide it.

### September 21: shallow Venus and temperature history

The Early Venus transition at 2.121632 Gyr reproduced the reported 327 m
"buried ocean": 649.07 K at the atmospheric base, a remembered cold-pool
temperature of 646.096 K, 30.696 bar, and all 0.107431 EO already in the vapour
reservoir. That column was a diagnostic error. Thermal conversion history
alone cannot establish liquid: the pool calculation now checks the saturation
pressure before treating its proposed top as compressed liquid. At that
temperature even the old diagram's 60-bar floor was far below saturation.
See the [IAPWS saturation reference](https://iapws.org/faqs/faq1).
This rejects the unsupported column; it does not introduce a new vertical
two-phase solver or change the integrated temperature and water reservoirs.

Physically supported shallow pools use the same basin-filling law as open
oceans when clouds are hidden. The previous fraction-of-20-km rule, multiplied
by the hot-area fraction, reduced visible coverage to 0.0077% in this case.
The pressure check is shared by classification, Structure and temperature
selection, so the UI cannot present that rejected column as a real ocean.

History now records changes of at least 2 K between samples and always draws
the current state as its endpoint, including paused edits. The former 2%-of-age
schedule could wait 42 Myr at this transition and leave the chart near 40 C
while the ground was already 376 C. The common sampling/endpoint correction
also applies to stable, dev and altdev. Buried-liquid and atmospheric traces
remain specific to altdev2. Old saved samples are not retroactively recomputed.

Reproduction checks: `node tools/venusdisplaycheck.mjs` and
`node tools/venuspaintcheck.mjs`. The second executes the software renderer
and chart drawing against in-memory canvas buffers; it is not a browser-layout
test. Optional browser/GPU verification still depends on those facilities
being available.

In **Worlds**, choose **Small Waterworld (2019)**, **Evaporating Small
Waterworld**, **Icy Small Waterworld**, or **Hot Waterworld · 0.049 M⊕**.
Europa, Ganymede and Callisto are separate icy-moon scenarios (see below).
Selection is **automatic** from mass, bulk water inventory, current non-water
gas pressure and stellar spectrum. There is no model checkbox. Legacy
`lowGravityWaterworld=true/false` values in links or saves are ignored; neither
can force or suppress the appropriate branch.

Source: Arnscheidt, Wordsworth & Ding (2019), *Atmospheric Evolution on
Low-gravity Waterworlds*, attached arXiv:1906.10561v2 PDF;
<https://arxiv.org/abs/1906.10561>.

## What is implemented

- Equation 1, `R/R_E = 1.258 (M/M_E)^0.302`, sets the reference geometry for
  the radiation table. The actual world now uses the same composition-based
  solid radius as every other world, with measured-radius corrections for the
  moon presets. An atmosphere-model flag no longer changes the solid radius.
  Mass and solid radius still stay fixed as the reservoir evaporates, a poor
  approximation after substantial loss of the original planet mass.
- Spherical, globally averaged forcing and saturated water vapour in the core
  regime: positive masses up to 0.12 Earth masses (including 0.005 M⊕), a
  5200–6200 K star, and at least 40 km of configured global water equivalent
  on the rocky-radius estimate. The contribution tapers smoothly to zero across
  0.12–0.30 M⊕, 4800–5200 / 6200–6600 K, and 20–40 km water depth.
  These overlap widths are **numerical model choices, not physical thresholds
  derived from the paper**. They prevent the former hard 0.2 M⊕, spectrum and
  basin-capacity switches from creating finite climate jumps. There is no 1 mbar background-gas
  cutoff: adding CO2 or another gas uses the approximate mixed-atmosphere
  extension below, retaining low-gravity geometry. At reservoir exhaustion the
  radiation approaches the dry limit continuously (blackbody only without
  remaining greenhouse gases). A dry CO2 world is not automatically airless.
  A tiny vapour residue is not an ocean.
- Equation 2: shortwave and longwave areas are distinct. The energy balance is
  `f_SW (1-A) S/4 + F_internal - f_LW F_out - (gR+L) Phi`.
  A mixed bulk wind also subtracts `gR Phi_background` for gas lifted away.
- Equations 8–11 supply the collisional isothermal steam-wind branch, global
  mass loss, and remaining-water lifetime. At `r_c/r_s >= 10`, the wind branch
  uses equation 9. For weaker binding it solves the full isothermal Parker
  relation instead of extending that asymptotic expression past its domain.
- A wind is not assumed valid just because ice supplies some saturated vapour.
  A mean-free-path/scale-height check follows an isothermal hydrostatic column
  toward the sonic point. If it becomes collisionless first, the model locates
  the `Kn = 1` exobase and transitions to whole-molecule Jeans escape there.
  Surface-collisionless gas uses the surface as the escape base. A smooth
  interpolation across sonic-point `Kn = 1–100`, and the effective collision
  cross-section `2.7e-19 m²`, are **reduced-model assumptions**, not results
  transcribed from the 2019 paper. This is not a kinetic transport calculation
  or a model of a heated thermosphere; see [Volkov et al.](https://arxiv.org/abs/1009.5110)
  for the physical distinction between hydrodynamic and Jeans escape.
- Escaping **whole water molecules** deplete the reservoir without leaving the
  oxygen produced by the ordinary hydrogen-photolysis escape model. These two
  escape channels are not double counted. The cooling term and reservoir loss
  use the same mass flux, with seconds/years converted explicitly. Ice supply
  uses sublimation latent heat, not liquid-water vaporization latent heat.
- An ice-albedo feedback permits cold and warm histories at the same sunlight.
  The four fictional waterworld presets start with 40% of their mass in water.
- Surface ice does not imply that the entire water column is frozen. The icy
  preset supplies an assumed 20 mW/m² of internal heat; the existing conductive
  shell/interior calculation then decides whether liquid survives beneath it.
  Zero internal heat or insufficient water does not automatically create an
  ocean. Reload the preset to get this new heat setting; existing saves and
  shared custom worlds retain their own settings.
- Readouts show current-condition water lifetime, radiative area ratios and
  escape cooling. The phase chart uses radiation **plus escape cooling** for
  its outgoing curve. The ordinary plane-parallel runaway-margin indicator
  is replaced while this mode is active.

## Approximation and limits — not a numerical reproduction of the paper

The paper's line-by-line HITEMP radiative calculations and their complete
gravity/temperature grid are **not included**. `physics/waterworld.js` uses
approximate readings of Figure 2's right-hand curves at 0.12 Earth masses,
linear interpolation in temperature, and transfer of their effective
gravitational-potential heights to other radii. A smooth grey outgoing-flux
ceiling is normalized to about 247 W/m² at 2.3 m/s², with an explicitly
approximate gravity dependence. Liquid albedo is 0.2, ice albedo 0.6, with a
15 K transition. These are reduced-model choices, not recovered spectral data.

The radiation approximation covers 200–600 K and a Sun-like spectrum. Scaling
factors are held at the table ends outside this range, and the interface warns
about extrapolation or weak binding. It does not implement the paper's AD
Leonis spectral calculation, cloud dynamics, detailed ocean chemistry, or a
self-consistent changing planetary mass/radius. Very hot/dry extrapolations
are numerical safeguards, not scientific predictions.

**Do not use this implementation to quote the paper's exact habitable-zone
edges or its 0.0268-Earth-mass cutoff.** That cutoff has not been reproduced.
The original literal equation-9 calculation did not reproduce Figure 4's
threshold, and the additional kinetic closure is not a resolution of that
discrepancy. The code does not insert a multiplier to force agreement.

The lifetime tile is inventory divided by **today's** rate, not an integration
of the future stellar/climate history. The original isothermal wind is an
upper-loss approximation within its assumptions; the added kinetic closure
does not establish a universal lifetime bound, particularly with omitted
upper-atmospheric heating and nonthermal processes.
“Long-lived water” does not assert biological habitability, especially at high
temperatures or without nutrients.

## Icy moons and hot-ocean example

The moon presets use [JPL satellite GM and mean radii](https://ssd.jpl.nasa.gov/sats/phys_par/),
converted with Earth's GM of 398600.436 km³/s². Their rotation periods use
[JPL satellite orbital elements](https://ssd.jpl.nasa.gov/sats/elem/).
They receive sunlight at 5.2044 AU. They are synchronous to Jupiter, **not to
the Sun**: the sandbox's stellar tidally-locked switch is off. `radiusScale`
calibrates the composition radius to the measured radius and survives
save/import/share links; it defaults to 1 for every pre-existing world.

| Preset | Radius (km) | Assumed water | Assumed internal heat |
|---|---:|---:|---:|
| Europa | 1560.8 | 2.5 Earth oceans | 40 mW/m² |
| Ganymede | 2631.2 | 40% of mass | 8 mW/m² |
| Callisto | 2410.3 | 40% of mass | 4 mW/m² |

These are illustrative ocean-bearing interior scenarios, **not calibrated
predictions of present-day ice/ocean thickness or surface temperature**.
Europa's ocean has strong evidence, whereas Callisto's remains possible, not
confirmed (NASA: [Europa](https://science.nasa.gov/jupiter/jupiter-moons/europa/europa-facts/),
[Ganymede](https://science.nasa.gov/jupiter/jupiter-moons/ganymede/facts/),
[Callisto](https://science.nasa.gov/jupiter/jupiter-moons/callisto/facts/)).
The conductive icy-interior model is independent of atmospheric model selection.
All three moons meet the low-mass water-rich bounds automatically. Cold vapour
does not imply a steam wind.
The climate
treats their exospheres as negligible bulk atmosphere, uses the shared ice
albedo, and omits Jovian plasma sputtering, eclipses, detailed tidal evolution,
and differentiated layered ice transport. Their equilibrium mean temperatures
near 96–97 K and calculated ocean depths must be read with those limits in mind.

At 1.11 Earth sunlight, the **0.049 M⊕** hot preset settles near **396.6 K
(123.5 °C)** with an ocean and a damped, nearly zero energy residual. In that
state, suppressing radiative-area expansion leaves roughly +62 W/m² of heating;
escape cooling is below 1 W/m². Its hot equilibrium in this approximation is
therefore supported by expanded thermal emission, not by an arbitrary
temperature clamp or escape refrigeration. Low mass does not protect against
all possible forcing, nor does this claim reproduce the paper quantitatively.

## Reproducible checks

From the project root:

```sh
node tools/reviewcheck.mjs
node altdev2/tools/waterworldcheck.mjs
node altdev2/tools/structurecheck.mjs
node altdev2/tools/mixedwatercheck.mjs
node altdev2/tools/smoketest.mjs
```

The dedicated checks cover equation transcription and units, radiative
expansion, energy residual and numerical damping, conservative reservoir loss,
no spurious oxygen, warm/cold branches, save/import continuation, weak-binding
and dry safeguards, and the preset water mass fractions. Additional regressions
cover the reported 0.045 M⊕ world through 5.75 Gyr, its dry/trace-vapour label,
cold-ice Jeans escape, subglacial versus fully frozen interiors, the stable
0.049 M⊕ hot ocean, and all three moon radii/interiors and save round-trips.
They validate the
implemented approximation; they do not certify the paper's quantitative results.

### Verification snapshot — 2026-09-19 follow-up

- 18 dedicated waterworld checks and 30 cross-build review regressions passed.
- All 32 modules loaded; the DOM smoke check exercised the actual new-preset
  load and readout path, including ice, liquid ocean and trace-vapour labels.
- All 32 pre-existing non-waterworld presets retained bit-identical temperature,
  water and time trajectories over the bounded 200-step before/after comparison.
- The eleven root check commands completed successfully (204 physics checks,
  21 calibration anchors plus 3 reported known gaps). Real headless GPU checks
  skipped because the optional GL dependency is absent. The altdev2 module,
  shader-parser, CPU rendering, baking, body-map, fallback and resume checks passed.
- Full altdev2 calibration did not finish within the 180-second bound; this is
  not recorded as a pass. The targeted tests do not replace full calibration.
- The interactive browser was unavailable in this session. DOM assertions and
  CPU-render tests passed, but are not a claim of visual browser verification.

### Automatic selection and consistent structure — 2026-09-20

The compact depth readout now sums the exact same layers drawn in the structure
diagram. Previously it read a hypothetical open-ocean column even when the
diagram correctly used the different subglacial column. Ice shell, liquid ocean,
high-pressure ice floor and supercritical layers are now kept distinct.

Atmospheric scale height alone no longer creates a gas layer in a vacuum or
surface-collisionless exosphere. The schematic extent is capped at the estimated
collisionless transition in a constant-scale-height column, using an assumed
effective cross-section of `2.7e-19 m²`; it is not a measured atmospheric edge.
Cold water-dominated gas is called water vapour, not steam, and very tenuous
collisional layers show their base pressure. Real exospheres can extend far
beyond the collisional column ([NASA overview](https://science.nasa.gov/moon/lunar-atmosphere/));
omitting a bulk-atmosphere band does not mean absolutely no gas exists.

The uniform composition-radius calculation slightly changes the four fictional
waterworlds' gravity and escape rates: the evaporating preset can now exhaust
its ocean before the 70 Myr check. Its final dry state is tested, not forced back
to an ocean label. The hot preset remains a stable liquid-ocean equilibrium.
Thirty-three unaffected presets retain bit-identical 200-step temperature,
water and time trajectories. The 18 waterworld checks, four new model/structure
checks, and real readout generation against the DOM stub pass. Full altdev2
calibration again reached its 180-second bound; browser interaction was
unavailable. Neither is claimed as a completed validation.
The eleven root commands completed with 204 physics tests and 21 calibration
anchors passing (3 known gaps reported). Shader parsing and CPU rendering/baking
passed for both root and altdev2. Optional real-GPU checks skipped because the
headless GL dependency is absent.

### CO2 and very small waterworlds — 2026-09-20 follow-up

The previous selector incorrectly disabled the entire low-gravity calculation
below 0.01 M⊕ or above 0.001 bar of background gas. A 0.02 M⊕, 300 K example
jumped from about 289 to 387 W/m² outgoing radiation across that gas cutoff.
Neither cutoff is retained. The readout now identifies mixtures explicitly as
**Low gravity · mixed atmosphere**.

This extension is **not in the pure-water 2019 paper and has not been validated
as a quantitative mixed-atmosphere climate model**. It combines existing
semi-grey gas opacities, spherical geometry and simplified escape physics:

- The existing CO2/CH4/H2 opacity and pressure-broadening contributions are
  added as the mixed-minus-pure optical resistance, avoiding duplicate water
  opacity. Hydrogen convective inhibition remains in that resistance.
- Effective hydrostatic heights use the pressure-weighted mean molecular mass.
  Additional grey photospheric heights use `R_specific T ln(1 + tau)` as a
  potential difference in spherical gravity. Background scattering reuses the
  existing Rayleigh approximation. This is not wavelength-resolved transfer or
  a vertically resolved moist adiabat; area caps still limit unbound extrapolation.
- A collisional mixture wind uses its mean molecular mass and removes both
  water and background gas. A trace of CO2 therefore cannot act as an immovable
  cap on an otherwise blowing-off atmosphere. In the collisionless/bound limit,
  a hard-sphere binary diffusion conductance limits molecular water supply.
  The transition uses the existing sonic-point Knudsen interpolation. This is
  a one-fluid/kinetic approximation, not species-resolved drag, chemistry or
  a heated-thermosphere calculation.
- The existing photolytic, envelope and nonthermal loss channels remain for
  mixtures. Photolytic water loss fades with background mole fraction toward
  the pure molecular-water limit. Only that photolytic share leaves oxygen.
  Lifetime uses combined current water loss; it is not a future-retention forecast.
- Current water/gas loss rates constrain the timestep after smoothing, including
  the first step, so a rapidly disappearing background is not skipped over.

Physical motivation: expanded optical surfaces are discussed by
[Goldblatt (2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4442573/);
diffusion and drag in gas mixtures by
[Hunten (1973)](https://journals.ametsoc.org/abstract/journals/atsc/30/8/1520-0469_1973_030_1481_teolgf_2_0_co_2.xml).
These sources do not validate the combined approximate implementation above.

Nine new regressions cover 0.005 M⊕, a 0–10 bar CO2 sweep, continuity across
the old thresholds, actual opacity/molecular-weight effects, matching flux and
damping, water conservation, gas drag, trace-gas continuity, dry atmospheres,
save/import continuation, and four-times finer stepping through rapid gas loss.
In the tested one-year transients the finer runs differ by less than 0.6 K,
0.1% of water and 0.001 bar of CO2; this is a numerical check, not physical validation.
The 18 existing waterworld checks, 4 structure checks and 30 cross-build review
checks pass. All 38 unaffected presets have bit-identical 200-step trajectories;
Europa now also uses the low-gravity branch and retains its subglacial ocean.
The root suite again passes 204 physics tests and 21 calibration anchors, with
3 known gaps reported. GPU-driver checks remain skipped without headless GL.
The full altdev2 calibration limitation described above remains unresolved.

### Save, boundary and interior consistency — further September 20 review

The earlier validation paragraphs are historical snapshots, not the current
test status. The follow-up adds `tools/statuscheck.mjs` and repairs:

- Numeric `null` imports (including JSON-encoded infinities) are dropped; valid
  `weathering` and `lifeRoom` runtime objects are preserved. Exact JSON
  save/restore/continuation is tested on Earth, Hycean and icy/hot waterworlds.
- Epochs, pending epoch candidates and marks reset with a new world, before its
  first restore point is captured. Sub-year starts cannot inherit another run.
- The overlap above blends humidity, illumination, outgoing radiation, absorbed
  flux and molecular cooling/loss. Photolytic and carrier-gas escape approach
  their ordinary limits continuously. Damping differentiates the actual combined
  flux in the overlap. The UI reports **Blended atmosphere** and its contribution;
  the overlap is not claimed to reproduce either paper's quantitative results.
- Absence of an H2 envelope is no longer used as proof of a rocky, shallow-water
  interior. Explicit guards still protect inherited rocky presets. New water-rich
  moons and planets may have differentiated water/ice mantles.
- Subglacial shells apply salinity's **absolute** melting-point depression, not
  the sea-ice climate curve's Earth-relative shift. That removed an erroneous
  1.92 K warming of freshwater melting. The high-pressure floor now includes the
  existing approximate ice III/V melting curve rather than allowing all liquid
  to persist until the ice VI field at 0.632 GPa. A floor spanning unresolved
  phases is labelled **high-pressure ice**, not specifically ice VI.

The cold III/V curve is still a reduced interpolation between melting-curve
endpoints, not the reference-quality [IAPWS phase equations](https://iapws.org/public/documents/MdUFK/MeltSub2011.pdf).
Salt depression is a simple offset, not a high-pressure brine equation of state.
Ice convection, phase-dependent conductivity/density and internal differentiation
remain approximate; these are not precision reconstructions of moon interiors.

At 3 mW/m² and a 97 K surface the old pure-water Callisto scenario no longer
has a liquid layer in this closure; it is correctly labelled frozen instead of
inventing water beneath the shell. The **preset** now explicitly assumes
4 mW/m², within the published 2.6–4.2 mW/m² scenario range
([LPSC 2017, abstract 1137](https://www.hou.usra.edu/meetings/lpsc2017/pdf/1137.pdf)).
It retains a calculated subglacial ocean. This heat flux is an assumption, not a
measurement; existing saves/custom worlds keep their heat settings. A 3 mW/m²
test ensures the code does not force the ocean to exist.

Final September 21 validation: **410 self-tests passed, 0 failed**, and **35
calibration anchors passed**, with 12 known model gaps reported separately.
The 17 new status regressions, 18 waterworld checks, 9 mixed-atmosphere checks,
4 structure checks, 36 cross-build review checks and module/readout smoke tests
pass. Thirty-eight of 39 presets retain bit-identical temperature/water
trajectories over 200 fixed steps; Callisto changes with its documented heat
setting. The root build passes 204 self-tests and 21 calibration anchors
(3 known gaps). Shader parsing, CPU rendering/baking and fallback/resume tests
pass. Real GPU-driver tests skip without headless GL; no browser connection
was available for interactive visual verification. These numerical checks do
not validate the approximate atmosphere/interior closures as precision models.
