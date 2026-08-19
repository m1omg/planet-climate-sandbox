# Planet Climate Sandbox

Build a terrestrial planet — its mass, water inventory, atmosphere, star and spin — and watch its
climate evolve over geological time into snowball, temperate, dune-world, eyeball, moist greenhouse,
runaway greenhouse and beyond.

**▶ [Play it here](https://example.invalid)**  *(link filled in on deploy)*

No build step, no dependencies, no CDN. Plain ES modules, raw WebGL2 for the planet, Canvas2D for
the charts.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node src/selftest.js            # 26 physics + determinism checks
```
Open with `?selftest=1` to run the same suite in the browser console.

---

## What it models

A **zonal energy-balance model** over 18 equal-area latitude bands. For a fast rotator the band
coordinate is `sin(latitude)`; for a tidally locked world it becomes `cos(angle from substellar
point)`, so the same solver produces eyeball and lobster states.

Longwave radiation uses a semi-grey two-stream form, `OLR = σT⁴ / (1 + ¾τ)`, with band optical
depths `τ = k · p_gas^m · p_total^0.3`. The coefficients were fitted simultaneously to three
independent anchors:

| Anchor | Target | Model |
|---|---|---|
| Modern Earth | 240 W/m² at 288 K, 280 ppm CO₂ | 233 W/m² |
| Venus | ~160 W/m² at 737 K, 92 bar CO₂ | 161 W/m² |
| Simpson–Nakajima runaway limit | 282 W/m² (Goldblatt 2013) | **283 W/m² at 351 K** |

The third is not imposed anywhere in the code. Hold water at saturation and the fitted expression
*peaks* at 283 W/m² — so the runaway greenhouse falls out of the radiative physics rather than being
triggered by a threshold test. Push absorbed sunlight past that peak and no equilibrium exists at
any temperature.

### Why transitions take the time they really take

The user-visible point of the model is that nothing snaps. Three things enforce that:

* **Latent heat as heat capacity.** Every extra kelvin near the runaway evaporates more ocean, and
  that term dwarfs the mixed layer. The runaway transient comes out at 10³–10⁵ yr depending on how
  hard the planet is being pushed, against ~10⁵ yr in Turbet et al.'s 3-D GCM.
* **Escape is slow.** Hydrogen loss is the lesser of the diffusion limit (from the cold-trap mixing
  ratio) and the XUV energy limit. Losing an ocean takes 10⁸–10⁹ yr under a young, active Sun —
  Kasting's Venus timescale — so a *wet* runaway drifts into a *dry* one over hundreds of Myr.
* **The carbonate–silicate thermostat.** Buffered by the ocean and reactive crust, it relaxes on
  ~1 Myr; inside a snowball the sink shuts off and volcanic CO₂ piles up for millions of years.

An adjustable clock (1 yr/s → 10 Myr/s) lets you watch any of it.

### Climate states it recognises

Magma ocean · dry runaway (Venus-like) · wet runaway · moist greenhouse · ice-free hothouse ·
temperate · waterbelt/slushball · hard snowball · eyeball · lobster · nightside-trapped desert ·
dune/desert world · waterworld · Mars-like collapse · Titan-like · airless rock.

### Frame-rate independence

Physics advances on simulated time only. Elapsed real time buys *credit*; steps are sized purely
from the state of the planet, and a step is taken only when there is credit to pay for it in full.
Because the step sequence never depends on where frame boundaries fell, 90 fps, 15 fps and randomly
paced frames with stalls trace **bit-identical** trajectories (verified: max ΔT = 0.00 K).

The solver is semi-implicit and linearised over both the longwave *and* shortwave feedbacks, with a
quasi-static shortcut that strides over quiet epochs — gated off wherever the radiative damping goes
negative, since that is exactly a runaway and striding over it would invent equilibria the planet
does not have.

---

## Known deviations from the literature

Stated plainly, because a model that hides these is less useful:

* **Snowball deglaciation happens at ~0.02 bar CO₂**, against the 0.1–0.3 bar of published snowball
  studies. The semi-grey CO₂ opacity is stronger at intermediate pressure than line-by-line models.
  The *behaviour* — hysteresis, multi-Myr duration, unopposed CO₂ build-up — is right; the threshold
  sits low.
* **The runaway inner edge is at ~1.55 S⊕**, against 1.2–1.4 in published 3-D GCMs (Leconte 2013;
  Wolf & Toon 2014). Cloud and dry-subsidence parametrisations are crude.
* Earth needs ~396 ppm rather than 280 ppm to reach 288 K once the thermostat has converged.

## References

Goldblatt et al. 2013 (runaway radiation limit) · Kasting 1988 (moist/runaway greenhouse, water
loss) · Goldblatt & Watson 2012 · Turbet et al. 2023 (3-D runaway transition) · Wolf & Toon 2014 ·
Leconte et al. 2013 · Abe et al. 2011 (habitable zone limits for dry planets) · Yang et al. 2014
(slow rotators, substellar cloud deck) · Pierrehumbert, *Principles of Planetary Climate* ·
Turbet et al. 2017 (CO₂ condensation limits deglaciation).

## Licence

MIT
