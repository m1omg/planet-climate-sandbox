# Small waterworlds (altdev2 only)

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
