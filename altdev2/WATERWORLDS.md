# Small waterworlds (altdev2 only)

In **Worlds**, choose **Small Waterworld (2019)**, **Evaporating Small
Waterworld**, **Icy Small Waterworld**, or **Hot Waterworld · 0.049 M⊕**.
Europa, Ganymede and Callisto are separate icy-moon scenarios (see below).
The additional checkbox under
starlight enables/disables the model. Its flag survives save files and share
links. All pre-existing presets leave it off.

Source: Arnscheidt, Wordsworth & Ding (2019), *Atmospheric Evolution on
Low-gravity Waterworlds*, attached arXiv:1906.10561v2 PDF;
<https://arxiv.org/abs/1906.10561>.

## What is implemented

- Equation 1: `R/R_E = 1.258 (M/M_E)^0.302`. As in the paper, mass and solid
  radius stay fixed as the reservoir evaporates. This approximation becomes
  poor after losing a substantial fraction of the original planet mass.
- Spherical, globally averaged forcing and a saturated, nearly pure water-vapor
  atmosphere. The mode operates at 0.01–0.2 Earth masses and less than 0.001 bar
  of non-water gases. Adding a substantial background atmosphere returns
  atmospheric calculations to the standard model. At reservoir exhaustion the
  radiation approaches its dry blackbody limit continuously; classification
  becomes dry/airless, not a waterworld. A tiny vapour residue is not an ocean.
- Equation 2: shortwave and longwave areas are distinct. The energy balance is
  `f_SW (1-A) S/4 + F_internal - f_LW F_out - (gR+L) Phi`.
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
| Callisto | 2410.3 | 40% of mass | 3 mW/m² |

These are illustrative ocean-bearing interior scenarios, **not calibrated
predictions of present-day ice/ocean thickness or surface temperature**.
Europa's ocean has strong evidence, whereas Callisto's remains possible, not
confirmed (NASA: [Europa](https://science.nasa.gov/jupiter/jupiter-moons/europa/europa-facts/),
[Ganymede](https://science.nasa.gov/jupiter/jupiter-moons/ganymede/facts/),
[Callisto](https://science.nasa.gov/jupiter/jupiter-moons/callisto/facts/)).
The standard icy-interior model is used, not the 2019 steam model. The climate
treats their exospheres as negligible bulk atmosphere, uses the shared ice
albedo, and omits Jovian plasma sputtering, eclipses, detailed tidal evolution,
and differentiated layered ice transport. Their equilibrium mean temperatures
near 96 K and calculated ocean depths must be read with those limits in mind.

At 1.11 Earth sunlight, the **0.049 M⊕** hot preset settles near **399.4 K
(126.2 °C)** with an ocean and a damped, nearly zero energy residual. In that
state, suppressing radiative-area expansion leaves roughly +60 W/m² of heating;
escape cooling is below 1 W/m². Its hot equilibrium in this approximation is
therefore supported by expanded thermal emission, not by an arbitrary
temperature clamp or escape refrigeration. Low mass does not protect against
all possible forcing, nor does this claim reproduce the paper quantitatively.

## Reproducible checks

From the project root:

```sh
node tools/reviewcheck.mjs
node altdev2/tools/waterworldcheck.mjs
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
