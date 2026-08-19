# Planet Climate Sandbox

Build a terrestrial planet — its mass, water inventory, atmosphere, star and spin — and watch its
climate evolve over geological time into snowball, temperate, dune-world, eyeball, moist greenhouse,
runaway greenhouse and beyond.

**▶ [Play it here](https://m1omg.github.io/planet-climate-sandbox/)**

No build step, no dependencies, no CDN. Plain ES modules, raw WebGL2 for the planet, Canvas2D for
the charts.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node src/selftest.js            # 30 physics, determinism and control checks
node tools/smoketest.mjs        # loads every module against a stub DOM
node tools/glslcheck.mjs        # parses the shaders with a GLSL ES 3.0 grammar
node tools/shadercompile.mjs    # optional: compiles them on a real GL driver
```

Run these before pushing. `node --check` parses files as CommonJS and will happily
miss ESM-only errors, which is exactly how a duplicate declaration once shipped a
blank page; the smoke test loads the real module graph and fails on it. The shader
lives in `src/render/glsl/` as real GLSL rather than a JavaScript template literal
for the same reason — a stray backtick there breaks the whole module silently.
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

An adjustable clock (1 yr/s → 150 Myr/s) lets you watch any of it. Acceleration costs nothing in
accuracy: step size is chosen from the state of the planet, never from the clock, so the same
300 Myr run gives the same temperature to three decimals and the same CO₂ to 0.1 ppm whether it is
played at 100 kyr/s or 150 Myr/s. A world in a stiff transition simply advances more slowly and
says so.

### Two ways to draw a planet

The surface can be drawn from **generated albedo maps** (the default) or **fully procedurally**.
Both share the same lighting, climate response, clouds and atmosphere — only the surface albedo
differs, and the button in the view controls cross-fades between them at any time.

* `?graphics=procedural` — start in the procedural look
* `?graphics=textured` — start with the generated maps (the default anyway)

The generated maps live in `assets/textures/` as six equirectangular JPEGs (`rock`, `desert`,
`vegetation`, `ice`, `ocean`, `lava`) at the generator's native 1774×887 — about 3.3 MB for the
whole set, loaded once and mipmapped. If they are missing or fail to load, the planet quietly
stays procedural and says so — the procedural path is a complete look in its own right, not a
fallback stub.

The procedural renderer uses gradient noise with domain warping for continents (so coastlines
have bays and peninsulas rather than round islands), a ridged multifractal for mountain belts,
slope-based relief shading, altitude- and climate-dependent biomes, and a two-layer sheared cloud
deck.

### Handling the planet

Drag the planet with a mouse or a finger to orbit the camera; flick it to spin and it coasts to a
stop. `⟳` pauses the planet's own rotation, `⌖` recentres the view.

Every control is live. Change one mid-run and the planet keeps its current temperature, ice cover
and history — you are intervening on a running world, not restarting it. Four of them (CO₂, N₂,
methane and the water inventory) are outputs as well as inputs, because volcanoes, weathering, cold
traps and escape to space all move them; those controls follow the simulation, except while you are
touching them. Click any value to type it exactly, with units — `420ppm`, `0.5 bar`, `1 atm`,
`2 days`, `30%`, `100x`.

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
* **The runaway inner edge is at ~1.85 S⊕**, against 1.2–1.4 in published 3-D GCMs (Leconte 2013;
  Wolf & Toon 2014). The cloud and dry-subsidence parametrisations are crude, and they buy this
  model more margin than the real physics does.
* **The dune-world advantage shows up as margin, not as a shifted threshold.** At the same flux a
  dry world runs cooler and loses water several times more slowly than an ocean world — the
  mechanism Abe et al. (2011) identify — but in this model both tip into a runaway at close to the
  same insolation, where Abe finds the dry world's inner edge moves substantially inward.
* Earth needs ~396 ppm rather than 280 ppm to reach 288 K once the thermostat has converged.

## References

Goldblatt et al. 2013 (runaway radiation limit) · Kasting 1988 (moist/runaway greenhouse, water
loss) · Goldblatt & Watson 2012 · Turbet et al. 2023 (3-D runaway transition) · Wolf & Toon 2014 ·
Leconte et al. 2013 · Abe et al. 2011 (habitable zone limits for dry planets) · Yang et al. 2014
(slow rotators, substellar cloud deck) · Pierrehumbert, *Principles of Planetary Climate* ·
Turbet et al. 2017 (CO₂ condensation limits deglaciation).

## Licence

MIT
