# Small waterworlds (altdev2 only)

In **Worlds**, choose **Small Waterworld (2019)**, **Evaporating Small
Waterworld**, or **Icy Small Waterworld**. The additional checkbox under
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
  atmosphere. The mode operates at 0.01–0.2 Earth masses, with remaining water
  and less than 0.001 bar of non-water gases. Adding a substantial background
  atmosphere returns atmospheric calculations to the standard model.
- Equation 2: shortwave and longwave areas are distinct. The energy balance is
  `f_SW (1-A) S/4 + F_internal - f_LW F_out - (gR+L) Phi`.
- Equations 8–11: isothermal transonic steam escape, global mass loss, and
  remaining-water lifetime. At `r_c/r_s >= 10`, the code directly uses equation
  9. For weaker binding it solves the full isothermal Parker relation instead
  of extending that asymptotic expression past its domain.
- Escaping **whole water molecules** deplete the reservoir without leaving the
  oxygen produced by the ordinary hydrogen-photolysis escape model. These two
  escape channels are not double counted. The cooling term and reservoir loss
  use the same mass flux, with seconds/years converted explicitly.
- An ice-albedo feedback permits cold and warm histories at the same sunlight.
  The three presets start with 40% of their mass in water.
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
For transparency, the literal equation-9 implementation with saturated water,
equation-1 radius and a 40%-mass reservoir gives a fixed-273.15-K, 1-Gyr
threshold near 0.0190 Earth masses; at 0.0268 Earth masses the corresponding
instantaneous lifetime is about 583 Gyr. This discrepancy with Figure 4 is
unresolved; the code does not insert a multiplier to force agreement.

The lifetime tile is inventory divided by **today's** rate, not an integration
of the future stellar/climate history. Isothermal escape is an upper-loss
approximation, hence this is a lower-lifetime estimate under that assumption.
“Long-lived water” does not assert biological habitability, especially at high
temperatures or without nutrients.

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
and dry safeguards, and the preset water mass fractions. They validate the
implemented approximation; they do not certify the paper's quantitative results.
