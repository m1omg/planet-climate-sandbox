# Planet Climate Sandbox

Build a terrestrial planet — its mass, water inventory, atmosphere, star and spin — and watch its
climate evolve over geological time into snowball, temperate, dune-world, eyeball, moist greenhouse,
runaway greenhouse and beyond.

**▶ [Play it here](https://m1omg.github.io/planet-climate-sandbox/)**

No build step, no dependencies, no CDN. Plain ES modules, raw WebGL2 for the planet, Canvas2D for
the charts.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node src/selftest.js            # 37 physics, coverage, determinism and control checks
node tools/smoketest.mjs        # loads every module against a stub DOM
node tools/glslcheck.mjs        # parses the shaders with a GLSL ES 3.0 grammar
node tools/shadercompile.mjs    # optional: compiles them on a real GL driver
node tools/rendercheck.mjs      # CPU port of the shader; renders a PPM to look at
node tools/bakecheck.mjs [512]  # does the baked cube map reproduce the terrain?
node tools/fallbackcheck.mjs    # does the software renderer draw a planet?
node tools/gl1check.mjs [--png] # runs the WebGL1 path on a real headless driver
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

Longwave radiation uses a semi-grey two-stream form, `OLR = σT⁴ / (1 + ¾τ)`, broadened by the
background air as `p_total^0.3`. Water and methane contribute power-law optical depths; **CO₂ is
logarithmic**:

```
τ_CO2 = 0.0514 · ln(1 + p / 5.46 µbar)  +  0.674 · p^0.87
```

The first term is the 15 µm band, whose core is already saturated at Earth-like amounts, so more CO₂
only widens the wings — the classic `5.35 ln(C/C₀)`, about 3.9 W/m² per doubling. The second is the
pressure-induced continuum: negligible below a few percent of a bar, and what carries Venus's 92 bar.

A single power law fitted Venus and got Earth badly wrong: it made **every doubling hit harder than
the last** (7.9, 9.6, 11.4 W/m²…), which tipped the planet into a runaway at 1.8% CO₂ — an outcome
the literature places a hundred times further out.

`tools/calibrate.mjs` checks twenty anchors against published values in one run:

| Anchor | Literature | Model |
|---|---|---|
| CO₂ forcing per doubling | 3.71 (Myhre 1998) / 3.93 (AR6) | **3.85 W/m²**, and flat across doublings |
| Pre-industrial Earth | 13.7 °C (1850–1900) | **13.9 °C** |
| Warming at 427 ppm | 1.45 K observed (transient) | **2.0 K** equilibrium |
| Equilibrium climate sensitivity | 3.0 K, likely 2.5–4.0 (AR6) | **3.1 K** |
| Glacial CO₂, 190 ppm | part of the LGM's −6.1 K (Tierney 2020) | **−3.5 K** |
| Planetary albedo | 0.293 (CERES) | 0.293 |
| Cloud cover | ~0.67 (ISCCP/MODIS) | 0.669 |
| Cloud feedback | +0.42 W/m²/K (AR6) | +0.06 |
| Equator-to-pole range | ~40 K annual mean | 36 K |
| Modern Earth OLR | ~239 W/m² at 288 K | 239 |
| Venus | 737 K, ~161 W/m² at 92 bar | 733 K, 161 |
| Mars | ~215 K | 212 K |
| Simpson–Nakajima limit | 282 W/m² (Goldblatt 2013) | **287 W/m² at 351 K** |
| Runaway from CO₂ alone | stable (Ramirez 2014); ~100× (Goldblatt 2013) | needs >500× pre-industrial |

The runaway limit is not imposed anywhere in the code. Hold water at saturation and the fitted
expression *peaks* at 287 W/m² — so the runaway greenhouse falls out of the radiative physics rather
than being triggered by a threshold test. Push absorbed sunlight past that peak and no equilibrium
exists at any temperature.

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
played at 100 kyr/s or 150 Myr/s.

Most worlds hold the full 150 Myr/s. A planet in a genuinely fast transition — mid-runaway, or a
tidally locked world still redistributing heat — advances more slowly, because those are the epochs
that actually have to be resolved, and the rate readout turns amber and reports the speed it is
really achieving rather than the one you asked for.

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

**All of that noise is baked.** It once cost 269 gradient-noise evaluations per pixel — 6,456
`sin()` calls, some 27 billion per frame at device-pixel-ratio 2 — which is why a tablet managed
about one frame a second. But none of it varies with time: the fields depend only on position on
the sphere and on the seed, and the climate merely recolours them. They are therefore computed once
per world into **cube maps** (not equirectangular maps, which would introduce pole pinching and a
wrap seam where the 3-D noise has neither) and sampled thereafter. Continent height is stored to 16
bits across two channels, because the shoreline ramp is only 0.036 wide and 8 bits would visibly
stair-step every coast. The surface normal is finite-differenced at bake time, which is what removes
the four extra surface evaluations relief shading used to cost every frame. Clouds, the one field
that genuinely moves, are baked too and animated by turning the direction they are sampled along.

The runtime shader now evaluates **5** noise fields per pixel, one of which only runs on a molten
planet, and `tools/glslcheck.mjs` fails the build if that budget creeps back up.

Detail is **High on every device** by default. `?quality=low` — or the ◆ button — halves the bake,
drops relief shading and the second cloud layer, and renders at 0.6 scale, for hardware that still
struggles. The simulation is identical in both: rendering and physics share nothing but a clock.

### When there is no WebGL2

WebGL2 is refused more often than it should be, especially on Linux: a graphics
blocklist entry or a failed driver probe is enough, with nothing wrong with the
card. Firefox reports this as `FEATURE_FAILURE_GLXTEST_FAILED`, meaning its
start-up GPU probe crashed before it ever asked the driver anything.

Rather than explain that to people, the renderer falls back — twice:

1. **WebGL1.** Older, and covered by looser graphics blocklists, so it is refused
   far less often. It draws the planet at full speed and full resolution: same
   shaders, mechanically rewritten from GLSL ES 3.00 to ES 1.00 by `toES100()` in
   `src/render/shaders.js`. The noise source is written to compile under both, the
   bake runs two passes instead of using multiple render targets, and the quad is
   bound per draw since WebGL1 has no vertex arrays. `tools/shadercompile.mjs`
   compiles this path on a real headless driver — which is how the missing
   integer `min()` overload in ES 1.00 was caught.
2. **Software.** If even WebGL1 is unavailable, `src/render/software.js` draws on
   the CPU via Canvas2D, sharing its shading with `src/render/cpushade.js`. It
   carries relief shading from a baked slope field, sun-glitter, depth-graded
   ocean, separate sea ice, land ice and frost, an advected two-layer cloud deck
   and an atmospheric limb — the same picture as the shader, evaluated in
   JavaScript. It draws in two layers: the sky at **full canvas resolution**,
   cached until the camera moves, and the planet disc over it at a measured pixel
   budget. Only the disc is shaded, since it covers about a quarter of the frame,
   and the limb is antialiased so the two layers meet cleanly.

The generated albedo maps need a GPU; software rendering is always procedural.

The button in the view controls reads **GL2**, **GL1** or **CPU**: it names the
renderer actually in use, and clicking cycles through all three, so every path
can be seen on any machine rather than only by whoever is unlucky enough to need
it. `?renderer=webgl1` and `?renderer=software` do the same. The button's choice is
deliberately **not** remembered between visits: forcing a lesser renderer is a
diagnostic, and making it stick meant one curious click left the planet drawn on
the CPU permanently. A reload always returns to the best renderer the machine
can give. The detail setting, which is a real preference, is still remembered.

GLSL ES 1.00 makes several things *optional* that ES 3.00 guarantees, and
headless drivers do not enforce the difference. `tools/glslcheck.mjs` therefore
lints for them directly: uniform arrays indexed by a computed index (which a
conforming WebGL1 driver may legally refuse, and which is what broke this path —
ANGLE reports `Index expression must be constant`), the fragment uniform-vector
count against the guaranteed 16, and the texture-unit count against the
guaranteed 8. Per-band temperature and ice now travel as a texture rather than
two 18-element uniform arrays, which removes both problems at once, and the
albedo maps are compiled out on devices too small to sample them.

`tools/gl1check.mjs` runs the real renderer against a real WebGL1 driver — the
two-pass bake, the cube-map framebuffer attachments, the absent vertex-array
object, the unsized texture format — and reads the framebuffer back to confirm a
planet actually appeared. Compiling the shaders proves the language conversion;
this proves everything around it.

### Coming back to the tab

Mobile browsers throw the GPU context away when a page goes to the background,
taking every program, buffer and texture with it. The renderer subscribes to
`webglcontextlost` and `webglcontextrestored` and rebuilds from scratch, and on
becoming visible again it rebakes the terrain and reallocates the drawing buffer
— because some drivers evict textures while a page is away without ever
reporting a lost context, which otherwise leaves the planet drawing from cube
maps that no longer exist.

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

### Phase limits

Liquid water needs more than the right temperature. Below the **triple point** — 611.7 Pa — it
cannot exist at any temperature: ice sublimates straight to vapour and standing water boils. That
is why Mars, whose surface sits at about 610 Pa, has frost and ice but no lakes, and the model
enforces it rather than letting a warm thin world keep an ocean it could not physically hold.

At the other end there is the **critical point**: 647 K and 220.6 bar. Above it the liquid and the
vapour stop being distinguishable — one supercritical fluid, no surface, no boiling, and no ocean at
all. A planet in a full wet runaway is past it, so it shows 100% land under a steam envelope rather
than a hot sea.

Between the two, an ocean at low pressure does not sit there placidly. Near the triple point water
boils and freezes at once: evaporation is violent, and the latent heat it carries away cools what is
left until it freezes. Mars is the worked example — even where the pressure and temperature briefly
allow liquid, it either boils off or freezes solid, because nothing supplies the heat that
evaporative cooling removes.

CO₂ freezing onto the poles is likewise **not** a one-way door. The frost point rises with pressure
while a thickening atmosphere warms the poles faster, so a collapsed atmosphere can be brought back:
in this model a cold world driven from 0.01 to 1.7 bar of CO₂ goes from 180 K to 717 K without
collapsing, which is the bistability Forget et al. describe for Mars (no collapse between roughly
0.6 and 3 bar).

### Land and ocean coverage

How much of a planet is under water is **derived, not chosen**. The control sets the *basin
geometry* — how much of this world would stand above the sea at Earth-like water — and the actual
coverage follows from the water that is really there, through a hypsometric curve
(`src/physics/hypsometry.js`):

```
flooded = (1 − L) · (W_basin / 1 EO)^0.25
```

`W_basin` counts liquid ocean **plus sea ice**, because ice floats and still fills its basin, but
**not** water vapour. So boiling an ocean uncovers its floor and land climbs to 100%, while freezing
one does not. The exponent is calibrated against real hypsometry: halving Earth's ocean drops the
flooded area only ~15%, because the abyssal plains are nearly flat.

Ice is tracked as two reservoirs with **different thresholds and different timescales**. Sea ice
forms as soon as the water freezes. An ice sheet needs somewhere cold enough for snow to survive the
summer — roughly −8 °C in the annual mean, which is why Siberia is frozen most of the year and
carries no sheet while Greenland does — and it needs tens of thousands of years to build:
**τ ≈ 15 kyr growing, 5 kyr melting**. That asymmetry is the sawtooth of the glacial cycles, a long
ragged descent and an abrupt termination (Abe-Ouchi et al. 2013).

Painting a sheet on the instant a continent dropped below freezing gave the albedo a hair trigger:
the model sat one part in a thousand of cloud albedo away from a runaway snowball, with an implied
climate sensitivity of 5–7 K. Sea ice seals the ocean off and shuts down evaporation; land ice
needs snowfall to exist at all. In a hard snowball the water cycle collapses, so the continents end
up frosted but largely unglaciated — as on the real Snowball Earth, and in the Antarctic Dry Valleys
today — which makes such a planet darker, and easier to escape, than one buried in ice.

## Known deviations from the literature

Stated plainly, because a model that hides these is less useful:

* **Snowball deglaciation happens at 5–10 mbar of CO₂**, against the 0.1–0.3 bar of published
  snowball studies. The semi-grey CO₂ opacity is stronger at intermediate pressure than line-by-line
  models. The *behaviour* — hysteresis, multi-Myr duration, unopposed CO₂ build-up — is right; the
  threshold sits low.
* **The runaway transient runs 10²–10³ yr**, against ~10⁵ yr in Turbet et al. (2023). This is
  energy conservation: vaporising an Earth ocean needs ~7×10¹² J/m² of latent heat, so the transient
  is that divided by the planet's net flux. The model reproduces the *scaling* — slow near the
  threshold, fast when pushed well past it — and the published figure corresponds to a forcing
  excess of only a few W/m².
* **Glacial cooling is −3.5 K at 190 ppm**, where the LGM was −6.1 K (Tierney et al. 2020). The
  difference is what the model is not given: the Laurentide and Fennoscandian ice sheets were a
  *prescribed* forcing set by ice dynamics and sea level, not something a zonal energy balance grows
  on its own, and glacial dust is absent too.
* **The cloud feedback is +0.06 W/m²/K**, against AR6's +0.42 (+0.12 to +0.72). Cloud *amount* is now
  nearly flat where Earth sits, which is right; what is missing is the shift in cloud altitude and
  optical depth that supplies most of the observed positive feedback.
* **A CO₂-only runaway needs more than 500× pre-industrial**, where Goldblatt et al. (2013) suggest
  ~100× may suffice. Ramirez et al. (2014) find Earth stable against CO₂ alone even under extreme
  assumptions, so the model sits on the conservative side of a genuine disagreement in the
  literature rather than outside it.

Two deviations recorded in earlier versions have since been **fixed** rather than excused: the
runaway inner edge now falls at 1.3–1.4 S⊕ (literature 1.2–1.4), and a dune world stays habitable
about 0.35 S⊕ further in than an ocean world, which is the Abe et al. (2011) result. Both were
symptoms of an integrator bug — the implicit step damped the global mean with the diffusion
coefficient, which only moves heat between latitudes and cannot slow uniform warming — that made
the whole planet heat thousands of times too slowly. It is now solved as the tridiagonal system it
actually is.

## References

Goldblatt et al. 2013 (runaway radiation limit) · Kasting 1988 (moist/runaway greenhouse, water
loss) · Goldblatt & Watson 2012 · Turbet et al. 2023 (3-D runaway transition) · Wolf & Toon 2014 ·
Leconte et al. 2013 · Abe et al. 2011 (habitable zone limits for dry planets) · Yang et al. 2014
(slow rotators, substellar cloud deck) · Pierrehumbert, *Principles of Planetary Climate* ·
Turbet et al. 2017 (CO₂ condensation limits deglaciation).

## Licence

MIT
