# Planet Climate Sandbox

Build a terrestrial planet — its mass, water inventory, atmosphere, star and spin — and watch its
climate evolve over geological time into snowball, temperate, dune-world, eyeball, moist greenhouse,
runaway greenhouse and beyond.

**▶ [Play it here](https://m1omg.github.io/planet-climate-sandbox/)**

No build step, no dependencies, no CDN. Plain ES modules, raw WebGL2 for the planet, Canvas2D for
the charts.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node src/selftest.js            # 144 physics, coverage, determinism and control checks
node tools/calibrate.mjs        # 21 observational anchors + 2 reported known gaps
node tools/smoketest.mjs        # loads every module against a stub DOM
node tools/glslcheck.mjs        # parses the shaders with a GLSL ES 3.0 grammar
node tools/shadercompile.mjs    # compiles them on a real GL driver
node tools/gl1check.mjs [--png] # runs the WebGL1 path on a real headless driver
node tools/rendercheck.mjs      # CPU port of the shader; renders a PPM to look at
node tools/bakecheck.mjs [512]  # does the baked cube map reproduce the terrain?
node tools/bodycheck.mjs        # do the real surface maps reach both surface styles?
node tools/fallbackcheck.mjs    # does the software renderer draw a planet?
node tools/resumecheck.mjs      # does the tab survive being switched away from?
```

Shipping is the default: commit, push, and the site is live. GitHub Pages serves
`main:/` directly, so `git push origin main` *is* the deploy — no `gh-pages`
branch, no build step. Verify afterwards by hash-matching a file you touched
against `https://m1omg.github.io/planet-climate-sandbox/`, because a "built"
status is not proof the change is out there. See `CLAUDE.md`.

All eleven, before pushing — `calibrate.mjs` above all, because a change that
fixes one anchor almost always moves three others, and the two `GAP` rows are
known deviations that report every run rather than failing. `node --check` parses files as CommonJS and will happily
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

Which of the two applies is asked, not inferred. It used to be read off the rotation period —
anything slower than a few hundred days was treated as synchronous — and a period cannot tell you
that: the Locked Eyeball here is synchronous at 264 h while Venus turns once every 5832 h and is
not locked at all, so every point on Venus sees the sun. Under a thick atmosphere the mistake is
invisible, because the circulation erases the day–night contrast. Strip the air off and it decides
the planet's fate: the world is handed a hemisphere that is never lit, it falls to 82 K, and it
swallows every molecule of CO₂ its volcanoes produce from then on. Rotating, the same world's
coldest band sits at 332 K. Rotation *rate* still matters for circulation — slow rotators have wide
Hadley cells and move heat freely — which is a separate factor.

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

`tools/calibrate.mjs` checks twenty-one anchors against published values in one run, and reports
two known gaps that are deliberately not fixed:

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
| Simpson–Nakajima limit | 282 W/m² (Goldblatt 2013) | **282 W/m² at 350 K** |
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
and history — you are intervening on a running world, not restarting it. Five of them (CO₂, N₂,
oxygen, methane and the water inventory) are outputs as well as inputs, because volcanoes,
weathering, photosynthesis, photochemistry, cold traps and escape to space all move them; those controls follow the simulation, except while you are
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

A steam envelope is opaque, and it gets that way early: a tenth of an Earth ocean in the air is
27 bar of vapour, and you can no more see through that than you can see Venus's surface. The
renderer used to reach full opacity at 3 bar — about 134 °C, with 95% of the ocean still liquid —
which hid the most interesting part of a runaway, the sea actually boiling away. Opacity now runs
logarithmically to the ~270 bar an evaporated Earth ocean really weighs.

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

Sea level on the globe is then the matching quantile of the baked height field, worked out on the
CPU once a frame. It used to be a straight line in the shader, `thr = 0.625 − 0.25·land`, which was
right only near the middle: **asking for 30% land drew 14.8%, and asking for 70% drew 81%**. The
height is very nearly Gaussian — N(0.4972, 0.05313) measured over eight seeds, with the quantiles
varying by only ~0.01 between them — so one curve serves every world, and every requested land
fraction now draws within about two points.

A world with no continents still has a thermostat. Seawater circulates through fresh basalt at the
mid-ocean ridges and lays carbon down there as carbonate, which is around a quarter of Earth's
silicate sink and the whole of a landless world's (Brady & Gíslason 1997; Coogan & Dosso 2015;
Krissansen-Totton & Catling 2017). Its temperature dependence is weaker, being tied to bottom water
rather than to the surface, and its CO₂ dependence milder. Leaving it out meant a waterworld's
climate simply drifted — and it was inconsistent, since the oxygen sink already leans on seafloor
oxidation for exactly the same reason. The split is normalised so Earth's total is unchanged; a
waterworld settles warmer and more carbon-rich than a continental world, and can now climb back out
of a snowball, which it previously could not.

`W_basin` counts liquid ocean **plus sea ice**, because ice floats and still fills its basin, but
**not** water vapour. So boiling an ocean uncovers its floor and land climbs to 100%, while freezing
one does not. The exponent is calibrated against real hypsometry: halving Earth's ocean drops the
flooded area only ~15%, because the abyssal plains are nearly flat.

A sea also has to be deep enough to be a sea. The power law above is calibrated in the middle of its
range, and taken to the limit it is badly wrong: it floods 1.6% of a planet with a *millionth* of an
ocean, which works out at twenty centimetres deep. Since the renderer draws whatever fraction this
returns as open water, a world the model itself called bone dry came out with blue seas along its
terminator. The deepest basin has a finite area, so as the water goes the flooded fraction must fall
in proportion to the volume rather than to its fourth root; requiring a mean depth of at least 50 m
imposes exactly that, and it binds only below a couple of thousandths of an ocean.

### Real worlds

Earth, Mars, Venus and Titan carry their **actual surface maps**, loaded when you pick that preset.

Geography is not a function of climate — warming Earth does not move its continents — so the map
stays put while you drag every slider, and only changes when you load a different world. Nothing has
to cross-fade as the climate runs, which is the whole reason this works.

Earth also carries its **real topography**, remapped at build time so its height distribution matches
the procedural terrain's. That means the same sea-level function serves both, and Earth's coastline
lands where it belongs: asking for 29% land draws 29.0%, with all ten test landmarks — the Sahara,
Kansas, the Amazon, mid-Pacific, Antarctica and the rest — on the right side of the water. Because
the map keeps its bathymetry (70% of the globe spread across the sub-sea levels, not clipped flat),
**sea level really moves**: drain the oceans and the continental shelves appear.

Switching between a real world and an invented one **dissolves region by region** rather than
blending everywhere, following the terrain's own detail field. That is not a stylistic choice. Two
worlds disagree about land-versus-sea over about 41% of the globe, so fading the *pictures* is a
double exposure with two sets of coastlines; and blending two height fields everywhere flattens the
relief and drains the land (measured: 30% → 18% at the midpoint). A regional dissolve makes every
point on the globe somebody's real coastline throughout, and holds the land fraction to within a
point.

Only Earth ships topography: it is the one body with a clean, redistributable grayscale DEM at a
usable size, and a plausible-looking but wrong Mars would be worse than an honest procedural one.
Sources and licences are in `assets/bodies/CREDITS.md`; the build is `tools/buildbodies.py`.

#### Three that are not in this solar system

**TRAPPIST-1b**, **TRAPPIST-1e** and **GJ 1132 b** are presets too, on their published numbers.
Masses, radii, periods and insolations from Agol et al. 2021 and Bonfils et al. 2018; interior heat
from Barr, Dobos & Kiss 2018 Table 3 and Swain et al. 2021. They get procedural terrain, because
nobody has a map of any of them.

| | S⊕ | interior heat | what it is |
|---|---|---|---|
| TRAPPIST-1b | 4.15 | **2.68 W/m²** — twice Io's | partially molten inside; JWST found no atmosphere |
| TRAPPIST-1e | 0.646 | 0.18 W/m² | the one in the habitable zone |
| GJ 1132 b | 18.8 | **80 W/m²** — a thousand times Earth's | magma ocean a few tens of metres down |

These are the worlds the internal-heat slider was built for. GJ 1132 b's 80 W/m² comes from an
eccentricity of only 0.01, held by resonance, and it settles here as a **dry runaway at 647 °C** —
not habitable, and not close. TRAPPIST-1b's substellar band lands at **539 K** against the **503 K**
dayside brightness temperature JWST measured (Greene et al. 2023), which is what a bare rock with
nothing to move its heat around looks like.

TRAPPIST-1e is the one that can hold water, and its preset is a *plausible* configuration rather
than a measured one — nothing is known about its atmosphere. A bar of CO₂ puts it at **19 °C** with
a quarter of the globe iced and most of its ocean liquid: an eyeball with a wide habitable ring,
which is what the GCM literature gets for it too (Turbet et al. 2018 model exactly this 1 bar case).
Those GCMs manage it on far less CO₂, because a locked world grows a thick cloud deck over the
substellar point that this model only approximates. A bar is at the thick end of plausible.

### Looking at it

Drag to orbit the camera — the star, the terminator and the ice caps stay where they belong and you
simply look from somewhere else. **Scroll or pinch to zoom**, double-click to reset. Zoom moves the
camera rather than narrowing the lens, so the planet keeps its perspective and the atmosphere's limb
still reads correctly; drag sensitivity scales with it, so the surface moves the same distance under
your finger however close you are.

**Axial tilt is drawn.** The spin axis leans by the obliquity and the whole planet leans with it —
bands, ice caps and surface together — so the terminator cuts across the latitudes at an angle
instead of running straight down the poles. It used to drive the seasons in the physics and be
completely invisible on the globe. A tidally locked world is exempt: its bands run from the
substellar point, not from a pole, so obliquity means nothing there.

### Oxygen, and the Great Oxidation

Oxygen used to be a fossil of hydrogen escape and nothing else — so the only route to an
oxygen-rich atmosphere was to boil an ocean, which is the Venus story, not Earth's. It is now the
same shape as the carbon cycle:

| | reservoir | source | sinks |
|---|---|---|---|
| carbon | `co2Bar` | volcanic outgassing | silicate weathering, cold traps |
| **oxygen** | **`o2Bar`** | **the biosphere** | **volcanic reductants, oxidative weathering** |

The numbers are set from Earth, not chosen. Its atmosphere holds 2141 kg/m² of oxygen and the real
net source is about 1×10¹³ mol/yr, which implies a residence time of **3.4 Myr** against a
literature 2–3. An Earth-like biosphere over Earth-like volcanism settles at **0.211 bar**.

**The threshold is the point of it.** Reduced volcanic gases consume oxygen as fast as it is made
until the biosphere outruns them, which is why the Archean stayed anoxic for a billion years with
photosynthesis already running. Below about 0.35× Earth's biosphere the air stays at nothing however
long you wait; above it, the atmosphere flips. Turn the volcanoes up and an oxygenated world goes
back under.

Oxidative weathering is first order in pO₂, which is what makes the level *settle* rather than climb
for ever — and it needs liquid water, so a planet that has boiled dry keeps whatever its lost ocean
left behind. On a waterworld with no exposed land at all, seafloor oxidation is the only sink there
is, and it is enough.

Earth's air is now **N₂ 78 / O₂ 21 / H₂O 1.4 / CO₂ 0.04**, against a real 78.1 / 21.0 / variable /
0.042. Splitting nitrogen from oxygen also takes the mean molar mass from 28.00 to 28.85 against a
real dry-air 28.96, which slightly sharpens the realistic atmosphere's scale height.

### The Huronian, played forwards

Raise the biosphere on an Archean world and the model runs the whole chain by itself:

| after | pO₂ | CH₄ lifetime | CH₄ | surface | state |
|---|---|---|---|---|---|
| 2 kyr | 1.1×10⁻⁴ | 19,000 yr | **1319 ppm** | +4.0 °C | temperate, methane still rising |
| 5 kyr | 2.8×10⁻⁴ | **10 yr** | 1.2 ppm | −17.3 °C | 60% ice |
| 10 kyr | 2.9×10⁻⁴ | 10 yr | **0.0 ppm** | **−46 °C** | **hard snowball** |
| 50 kyr | **0** | 12,000 yr | 7.8 ppm | −45.5 °C | snowball, oxygen gone |
| 2 Myr | 0 | 12,000 yr | 8.9 ppm | −45.4 °C | **still frozen** |

Methane *rises* first: the biosphere is turned up while the air is still anoxic, and an anoxic
biosphere routes far more of its carbon out as methane. Then the oxygen crosses the reductant flux,
the lifetime falls from nineteen thousand years to ten, and three thousand years later there is none
left.

The ocean freezes, so the biosphere stops, so the oxygen that caused all this is consumed — **and
the planet stays frozen anyway**. The trap shuts twice over: the trigger erases itself, and the
methane does not come back either, because the same dead biosphere that stopped making oxygen
stopped making methane. What returns is 8.9 ppm, the abiotic floor from serpentinisation alone,
against the 1000 ppm the world had before. Ice-albedo hysteresis does not care what caused the ice.

It is survivable: replace the methane's ~15 W/m² with CO₂ *before* the crossover. That is the **Great
Oxidation** scenario — and in it, life takes off whether you help or not.

That last part was missing, and without it the scenario was a formality. The biosphere sat at 0.2×
for ever, below the 0.385× where oxygen starts outrunning the volcanic reductant flux, so the event
never happened unless the player reached over and started it: **doing nothing was rewarded with a
stable world**, which is the opposite of the lesson. The cyanobacteria now spread on their own, on a
30 Myr e-folding from 0.2× towards Earth's present productivity — crossing the threshold around 8 Myr
in, which is enough warning to act on and not enough to ignore. It stops at 1.0×; this is life
spreading into a world that had none, not life becoming something no planet has supported.

| what you do | outcome |
|---|---|
| nothing | **lose** — frozen solid at −30 °C, 21 Myr in |
| CO₂ to 100 mbar first | lose — not enough to hold it above freezing |
| CO₂ to 150 mbar first | win, barely — oxygenated at −0.1 °C |
| CO₂ to 250 mbar first | win — oxygenated at 12 °C |

Ozone is not modelled, so there is no UV shielding feedback.

### The heat a planet makes for itself

Every world here used to be heated by starlight alone. That is defensible for Earth, whose interior
supplies **0.092 W/m²** — 47 ± 2 TW over the globe (Davies & Davies 2010), a twenty-six-hundredth of
the sunlight it absorbs. It is not defensible for anything tidally heated. GJ 1132 b is modelled at
**80 W/m²**, about a thousand times Earth's, which leaves a magma ocean under a few tens of metres of
crust and Io-like volcanism above it (Swain et al. 2021). Barnes et al. (2013) show tidal flux
reaching the runaway-greenhouse limit *on its own* and desiccating a planet the star would have left
habitable — a **Tidal Venus**.

The flux enters exactly where absorbed sunlight does, which is not a modelling choice so much as
energy conservation, and both papers do it independently: Barnes writes that energy supplied "by the
Sun, impacts, or tidal heating" exceeding `F_crit` ends radiation balance, and Barr et al. (2018)
compare stellar irradiation *plus* tidal heat against the same threshold. So the greenhouse amplifies
interior heat identically to sunlight, and at equilibrium the planet radiates exactly what its
interior gives it — measured here to better than 0.35 W/m² over a 0–60 W/m² range. Twenty watts is
worth **11 K** on an Earth-like world.

It costs eighteen additions per step and no extra radiative transfer.

| | W/m² | |
|---|---|---|
| Moon | 0.011 | global gamma-ray; Apollo 15 and 17 measured 0.021 and 0.015 |
| Mars | ~0.02 | modelled 0.006–0.025; **never measured** — InSight's mole never reached depth |
| Venus | 0.031 | a third of Earth's, consistent with a stagnant lid |
| Europa | ~0.04 | 0.006–0.046; ~0.039 at the sea floor with radiogenic heat |
| **Earth** | **0.092** | 47 ± 2 TW |
| Enceladus | 0.1–0.25 | localised, south polar |
| Io | 1–2 | and permanently molten for it |
| TRAPPIST-1b | 2.68 | Barr et al. 2018, Table 3 |
| GJ 1132 b | 80 | at e = 0.01, held by a resonance with GJ 1132 c |
| — | **>282** | past this the interior boils an ocean with no help from the star |

Barr's runaway thresholds for the TRAPPIST-1 planets — 258, 262, 277, 283, 308 W/m² — bracket this
model's own emergent Simpson–Nakajima limit of **282**, which is a pleasing independent check on a
number nothing here was tuned to produce.

**Heat drives volcanism too.** Outgassing is melt production times the CO₂ dissolved in the melt —
ocean-island primary melts run about 4 wt% CO₂ — and melt production is driven by the heat leaving
the interior. That is why Io resurfaces itself and the Moon has not erupted in a billion years. The
model scales outgassing by `√(F/0.092)`, anchored so Earth is exactly 1×: Io ≈ 4×, GJ 1132 b ≈ 30×.

The exponent is the honest weak point and is a **choice, not a measurement**. The direction is not in
doubt, but the rate also depends on the mantle's volatile content, its oxygen fugacity and its
tectonic regime, none of which this model knows. A half power is deliberately conservative; linear
would give GJ 1132 b 870× Earth's volcanism and empty its entire carbon budget in nine million years.

Weathering is deliberately *not* scaled with it. It shares the same mass normalisation, and boosting
both would move source and sink together — an error that leaves the equilibrium looking untouched. A
test pins it.

### Real interiors, as one-click pairs

Internal heat and volcanism are not two independent dials, so the internal-heat control carries a
row of **nine real bodies** that set both at once. The slider value is *specific* activity — what
a body's geology does per unit of heat — because the model already scales outgassing by
`meltBoost(F) = √(F/0.092)`. The number in each button's tooltip is the **total**, which is the one
with a physical meaning:

| | heat | slider | total outgassing |
|---|---|---|---|
| Moon | 11 mW/m² | 0 | none — dead for a billion years |
| Mars | 20 mW/m² | 0.02× | 0.01× Earth |
| Venus | 31 mW/m² | 1.2× | 0.70× Earth |
| Europa | 40 mW/m² | 0 | none — cryovolcanism moves water, not carbon |
| **Earth** | **92 mW/m²** | **1×** | **1×** |
| Enceladus | 0.15 W/m² | 0 | none, and south-polar rather than global |
| Io | 1.5 W/m² | 5× | 20× Earth — and it erupts sulphur |
| TRAPPIST-1b | 2.68 W/m² | 1.5× | 8.1× Earth |
| GJ 1132 b | 80 W/m² | 1× | 29× Earth |

The zeroes are statements, not gaps. GJ 1132 b needs no specific-activity multiplier at all: 80 W/m²
is a melt boost of 29 on its own, and **that is** the Io-like volcanism Swain et al. predict — asking
for 3× on top of it, as its world preset originally did, counted the same heat twice and landed on
ninety.

A button lights up only when *both* controls sit on it; half a pair is not that body. The self-test
checks that every stated total really is the slider value times the melt boost, that all nine survive
the slider round trip, and that Venus, Mars and GJ 1132 b agree with their world presets — so
picking Venus from the presets and Venus from this row cannot give two different Venuses.

### How much carbon a planet has

Volcanoes cannot outgas carbon the planet does not have, and until now they could: `outgassing` was an
infinite tap. Left running it produced **24,000 bar of CO₂** — thirty to a hundred times the entire
carbon inventory of an Earth-mass world — and drove the surface into the integrator's 4000 K clamp.

Carbon in the bulk silicate Earth — mantle plus crust, which is everything that can ever reach the
air — is a mass fraction of **1.4 ± 0.4 × 10⁻⁴**. Rather more is dissolved in the core and none of
that is coming back. Over Earth's surface that is 4.1×10⁶ kg/m², or **about 400 bar** of CO₂. Two
independent routes agree: Earth's carbon inventory is put at 2.5×10²² mol and possibly as high as
1×10²³, which is 210–850 bar, and the mass fraction lands in the middle of that.

Worth recording plainly: 1.4×10⁻⁴ is 140 ppm C, which is Hirschmann (2018) — the **bottom** of the
current range. Marty et al. (2020) and Sun & Dasgupta (2023) put the bulk silicate Earth at 330–400
ppm, which would make the budget 950–1150 bar rather than 400. Raising it would move Venus's emergent
28%-outgassed result and several anchors with it, so it stays where it is and the disagreement is
reported instead. The reservoir can be switched off entirely with **bottomless mantle**, for the same
reason the fossil reserve can: "what if it never ran out" is a fair question with an instructive
answer, and it is not how a planet works.

The scaling with planet mass is the honest part. Carbon is a roughly constant fraction of the
silicates for worlds that accreted from similar material, so the inventory follows the mantle mass —
and what matters to an atmosphere is the *column*, inventory over area:

| | mass | budget | actual atmosphere |
|---|---|---|---|
| Mars | 0.107 M⊕ | **51 bar** | 0.006 bar |
| Titan-mass | 0.15 M⊕ | 70 bar | ~0 |
| Venus | 0.815 M⊕ | 331 bar | **92 bar (28%)** |
| Earth | 1.0 M⊕ | 400 bar | 0.0004 bar |
| Super-Earth | 3.5 M⊕ | 1265 bar | — |

Venus having outgassed a quarter of its budget and Mars a ten-thousandth of its is the right shape:
Venus lost its water and with it the sink, Mars lost its volcanism and then its atmosphere. **Neither
needed a different carbon endowment to end up where it is**, which is the useful thing this says. The
model reaches 27% for Venus without being told to.

And it is a **cycle, not a drain**. Weathering does not destroy carbon, it buries it as carbonate, and
subduction carries it back down to be outgassed again — which is why Earth has run this for four
billion years on an inventory it would otherwise have exhausted in eight hundred million. Run Earth
for 5 Gyr and 100.0% of its carbon is still below, with CO₂ steady at 361 ppm. This is the
Sleep & Zahnle (2001) picture, in one reservoir rather than four.

The same world at 4 S⊕ with the outgassing control at 20× now stops at **400 bar and 1759 K** — the
whole budget in the air, a magma ocean, and nowhere further to go.

### Saves

Five slots, in the browser's own storage. A slot holds the whole world rather than just the controls:
the clock, the band temperatures, where the water is, how far the ice sheet has grown, what is left of
the fossil reserve and the carbon below. Saving only the sliders would have given back a world that
looked right and had forgotten everything it had been through, which for a model whose subject is
history is the wrong thing to keep.

There is also an **Earth-like** world in the preset row: Earth's physics without Earth's biography. No
industry, no real coastlines, and a fresh set of continents every time you load it — for trying
something out when the answer should not be about this planet in particular. The industrial control is
still there, it just starts at nothing.

**Deliberately not modelled:** formation distance and disk C/O, which shift the endowment by a factor
of a few; core mass fraction, which changes how much silicate there is to hold carbon; and impact
devolatilisation. Those are real, and they are why the band above is a factor of two wide — but none
of them is something this model has any way to know about a given world.

### The biosphere you ask for, and the one there is

The control is a request. What the planet supports is a separate number, and until now nothing showed
the difference — a world at 800 °C kept the control reading 1.00× Earth and **kept its ground green**,
because the shader's vegetation term was warmth and water and nothing else. The biosphere was not
wired into the picture at all.

Now `bio` is a state: it relaxes towards what photosynthesis can actually run at, dying over ~200
years and growing back over ~5000. Both the oxygen source and the ground colour come off it, and a bar
under the control shows what is alive against what was asked for.

| | asked | alive |
|---|---|---|
| Earth | 1.00× | 1.000× |
| the same world at 827 °C | 1.00× | **0.000×** |
| control at zero | 0.00× | 0.000× |
| control at three | 3.00× | 3.000× |

It comes back, which is the half that makes it a biosphere rather than a switch: cook a world to
0.056× under a CO₂ greenhouse, clear the CO₂, and 300 kyr later it is at 1.000× again.

### Where photosynthesis can run

The oxygen source used to be gated on one smoothstep of the global mean temperature between 330 and
360 K, which is the wrong quantity and the wrong numbers. It is now four conditions, taken **band by
band**, with the bounds set optimistically — the question is where photosynthesis is *possible*, not
where it is comfortable:

| | bound | why |
|---|---|---|
| temperature | −20 to **+73 °C** | the top is hard and measured: oxygenic photosynthesis stops where *Synechococcus lividus* gives out in the Yellowstone springs, and nothing on Earth passes 75 °C. The bottom is liquid water in brine films — Antarctic cryptoendoliths and snow algae fix carbon at −10 to −20 °C |
| light | a fraction of a W/m² | the compensation point is astonishingly low: green sulphur bacteria have been recovered photosynthesising in the Black Sea on ~10⁻⁴ of full sunlight |
| carbon | a few ppm CO₂ | cyanobacteria run carbon-concentrating mechanisms; C3 plants give up nearer 50 ppm |
| water | liquid, and enough to be a habitat | |

Band by band matters. A world averaging −30 °C can still run its whole biosphere off a warm
equatorial belt, and — the case a global mean cannot express at all — **a tidally locked world has a
night side where the light term is zero however warm the air is**. The Locked Eyeball comes out at
33% of its surface fit for photosynthesis, and its oxygen follows.

Earth comes out at 100.00%, so none of the oxygen calibration moved.

One honest note on the upper bound: it never binds on a *settled* world. The hottest stable climate
this model supports with an ocean is 59 °C and the next state up is a runaway at 594 °C, so the
73 °C limit only ever bites in transit — on the way into a runaway, where it stops the biosphere
before the ocean is gone rather than after.

### Us

`Industrial CO₂` is a rate, in multiples of today's: 40 Gt of CO₂ a year at 1×, some **forty times
every volcano on the planet put together**. Only the Earth preset has it switched on — it is kept off
the shared Earth constant so the dozen presets that spread it do not quietly inherit an industrial
civilisation along with the nitrogen.

The app boots on this world — the `earth` preset, not the bare Earth constant they otherwise share.
Those differ in exactly one field, and booting from the constant meant a fresh load gave a planet that
looked identical to the Earth chip and quietly behaved like a pre-industrial one: 427 ppm sitting
still instead of climbing. The warming is real, and hiding it in the default is worse than showing it.
The clock starts at **1 yr/s**, which is slow enough that the first century is legible as it happens.

It runs on a **finite reserve**, and that is the part that matters. Recoverable coal, oil and gas
come to something like 5000 Gt of carbon, which is 36 kg/m² of CO₂ or about thirteen times the
pre-industrial atmospheric column. At today's rate that is four and a half centuries and then it
stops, whatever the control says — so no world with it switched on can be run away by it.

| year | CO₂ | surface | reserve |
|---|---|---|---|
| 0 | 427 ppm | 15.15 °C | 100% |
| 150 | 1001 ppm | 18.9 °C | 68% |
| 300 | 1576 ppm | 20.5 °C | 35% |
| 462 | **2195 ppm** | 21.6 °C | **empty** |

Under the control is a bar showing what is left of it, a **Refill** button that puts the carbon back in
the ground, and an **unlimited** checkbox that ignores the reserve entirely. That last one switches off
the only thing keeping the control honest — with it ticked the same world passes 11,900 ppm in three
thousand years and keeps going. It is there because *what if we simply never stopped* is a fair thing
to want to ask, and the answer is worth seeing. It is not there because a planet works that way.

**Modern Earth starts with a tenth of its reserve already gone** — the ~1800 Gt of CO₂ we have put into
the air since 1750, which is 3.53 of the 36 kg/m². Pre-Industrial Earth has the lot, because nobody had
touched it. That is the same carbon that separates the two presets' 427 ppm and 280 ppm, so the two
numbers are now one fact rather than two settings.

Which makes this checkable against the only forcing experiment anyone has run on a whole planet. Burn
that 3.53 kg/m² starting from pre-industrial and the model takes 280 ppm to **441**, against the 427
observed. It is a calibration anchor now.

**44% of what is burnt stays in the air**, and that number is measured rather than chosen: 3.53 kg/m²
burnt against a rise of 1.50 gives a cumulative airborne fraction of 42%. The familiar "about half" is
the fraction of a *single recent year's* emissions, not of the whole; at a half this model took the
historical burn to 463 ppm instead of 427.

It does **not** go through the ocean-and-crust buffer the volcanoes go through. That buffer is an *equilibrium* partition, right for a volcanic flux slow
enough that the whole ocean keeps step with the atmosphere. A fossil pulse is four centuries long,
far faster than the ocean turns over, so only the surface layer takes part. Run it through the buffer
instead and burning all 5000 Gt moves the atmosphere from 427 to 500 ppm, which is not what it does.

And then the **long thaw**. Silicate weathering takes it back:

| after | CO₂ | airborne excess |
|---|---|---|
| 1 kyr | 2193 ppm | 100% |
| 100 kyr | 2019 ppm | 90% |
| 1 Myr | 927 ppm | 31% |
| 3 Myr | 370 ppm | 1% |

That is the silicate stage, and it is the right one: ~1 Myr, where the literature puts it. What is
still missing is the *early* part of the curve — the real staircase is ~50% airborne at 300 years,
~25% at 1 kyr and ~10% at 10 kyr as the surface ocean, the deep ocean and carbonate compensation take
their turns, and here the pulse simply sits until weathering gets to it. Fixing that needs an explicit
ocean carbonate reservoir, and the buffer that stands in for the ocean today (`CARBON_RESERVOIR_FACTOR`,
50) would have to be taken apart at the same time or the two would double-count.

This used not to work at all: the e-folding was **90 Myr**, so the spike was permanent on any timescale
you could watch. See below for why, because the reason is more interesting than the fix.

### Methane, and why it does not last

Methane used to sit wherever the control put it, for ever. It is not a stable gas, and what destroys
it depends entirely on the **redox state of the air**. In today's oxidising atmosphere OH radicals
take it out in about a decade; with no free oxygen there is no OH, and the only sink is ultraviolet
photolysis high up — the lifetime stretches to some ten thousand years, which is why the Archean
could hold percent-level methane at all. Its own haze then shields it and stretches that further.

It takes very little oxygen. **A thousandth of today's O₂ cuts the lifetime — and so the level a
given source can sustain — to under one percent.** Methane and free oxygen essentially cannot
coexist, which is why the Great Oxidation ended the Archean's methane greenhouse rather than merely
denting it. A world that loses its ocean oxidises itself: in the model, 0.8 oceans lost leaves 56
bar of O₂ and no methane at all.

Oxygen needed a sink of its own for that to work. Reduced volcanic gases and fresh crust consume it,
which is why the Archean stayed anoxic for a billion years with photosynthesis already running.
Without that, a planet that had lost **three hundred-thousandths of an ocean** had banked enough
oxygen to destroy its own methane for no reason at all.

#### The control is a reservoir

The methane slider says what is in the air now, and nothing about what keeps it there — the same
contract CO₂ and oxygen have. It did not always. The source used to be inferred once, from the level
asked for and the lifetime at that instant, and then frozen for the life of the world. That looked
convenient and was quietly broken:

| built as | lifetime when read | implied flux | take the oxygen away |
|---|---|---|---|
| oxic, 1.9 ppm | 10 yr | large | climbs to **2281 ppm** |
| anoxic, 1.9 ppm | 12,000 yr | 1200× smaller | stays at **2 ppm** |

Identical settings, two different planets, and which one you got depended on the order you had
touched the sliders in. Now the flux comes from controls you can see and the level is whatever they
sustain: the two routes agree to 0.02%, which is a test.

| source | at Earth | notes |
|---|---|---|
| biosphere | 8.07×10⁻⁴ kg/m²/yr | needs liquid water; stops when the planet cooks |
| ×2.7 if anoxic | | an anoxic biosphere routes far more carbon out as methane |
| interior | 7.5×10⁻⁶ kg/m²/yr | serpentinisation and mantle carbon, ~2 Tg/yr |

Oxygen does **not** switch the biological source off, even though methanogens are strict anaerobes.
Earth runs 21% oxygen and still emits ~150 Tg/yr out of waterlogged soil, sediment and guts, because
anoxic microhabitats survive inside an oxic world. What oxygen changes is how much of the biosphere's
carbon goes down that route — nearly all of it on an anoxic world, a sideline on ours. Hence a
factor, not a cutoff.

The split between the two sources matters more than it looks. Earth's ~38 Tg/yr of "geological"
seeps are **thermogenic** — buried organic carbon cooked back out of sedimentary rock — so they are
biological methane on a delay, not something an interior makes on its own. A world that never had
life has no source rock. File them under the interior instead and every sterile volcanic world in
the game grows an Archean methane greenhouse out of nothing, which is how this was caught: the model
started handing 1700 ppm to bare rock.

Earth's own budget is anchored on the **natural** ~218 Tg/yr, which gives the pre-industrial 0.72
ppm. Most of today's 1.9 ppm is ours, and with a ten-year lifetime that difference is a standing
emission rather than a legacy — so a modern-Earth world here relaxes to 0.80 ppm within a century.
That is the same treatment modern CO₂ already gets: a transient, not a fixed point.

#### Photolysis needs photons

A first-order lifetime says a fixed *fraction* of the methane goes each year, which quietly assumes
the ultraviolet can reach all of it. It cannot — methane is opaque to the very wavelengths that
destroy it — so past a certain column the sink stops being a fraction and becomes a **flux**, set by
how many photons arrive at all.

Without this Titan is a paradox. It is anoxic, so the thin rate gives it twelve thousand years, and
its 5% of methane should have been gone a hundred times over. What it actually gets here is **118
Myr**, against the 10–100 Myr of the literature, because it sits under 1% of Earth's sunlight with
120× Earth's methane column — photons per molecule some ten thousand times scarcer.

Which also means Titan's atmosphere is **not in steady state and cannot be**: nothing on that moon
is making 5% of an atmosphere. The model reproduces that too. Left alone it holds 5% for ten million
years, is down to 0.46% at a hundred, and is bare by three hundred — which is why Titan's methane
needs a resupply nobody has identified, and why the preset is best read as a snapshot of a world
caught mid-decline rather than a stable state.

### What methane is worth

Its opacity was a power law fitted to nothing, and it was four to ten times too strong:

| CH₄ | model, before | model, now | literature |
|---|---|---|---|
| 1.8 ppm (today) | 6.7 W/m² | **0.8** | ~0.7 (Myhre 1998) |
| 100 ppm | 30.0 | **8.8** | ~8 |
| 1000 ppm | 63.5 | **15.6** | ~15 (Byrne & Goldblatt 2014) |
| 1% | 114.4 | **30.0** | ~25, bands saturating |

One millibar of methane was doing more than twenty millibars of CO₂, which is why an Archean world
tipped into a runaway the moment the Sun brightened. Methane's bands are narrow and saturate early,
so like CO₂ its forcing is **logarithmic**, with a separate collision-induced term — a two-body
process, so it goes as the square of the density — which is nothing on Earth and is what actually
keeps Titan warm.

Correcting it meant refitting the water vapour term, which had been propping up Earth's greenhouse
alongside a methane error worth 6 W/m²: take it away and Earth settled at 4 °C. The **exponent** is
what made that possible — Earth sits at 0.011 bar of vapour and the runaway peak at 0.43, so the
coefficient alone could only trade one against the other. The refit is better on both counts than
what it replaced: the Simpson–Nakajima limit now lands at **282 W/m², the literature value exactly**,
where before it was 287. The Archean preset needs 0.08 bar of CO₂ rather than 0.02, which is what
the literature asks for once methane is no longer doing five times its share. (It has since gone to
0.10 — see below.)

That was the longwave. It was still only half the gas.

#### The ceiling, which had been missing entirely

Methane absorbs **sunlight** too — the near-infrared bands at 1.7, 2.3 and 3.3 µm — and deposits it
high in the atmosphere, where it radiates back out instead of reaching the ground. That is the same
anti-greenhouse geometry as the haze, from the bare gas, and it is what puts a **ceiling on the
methane greenhouse**:

> "the shortwave absorption becomes significant for pCH₄ > 10 Pa, with the total (longwave plus
> shortwave) methane radiative forcing … having a maximum of approximately 8.5 W/m², compared to
> 9 W/m² in Byrne and Goldblatt (2014)" — Eager-Nash et al. 2023

Past that peak more methane makes a planet **colder**. Eager-Nash put the maximum warming at
3.5–7 K, between pCH₄ of 30 and 300 Pa, and the fall past it at up to 8 K by 3500 Pa; below
pCO₂ = 1000 Pa some of their runs end up cooler than with no methane at all.

None of it was here. Methane was longwave-only, so its forcing simply grew:

| pCH₄ | model, before | model, now | literature |
|---|---|---|---|
| 10 Pa | 7.2 W/m² | **6.6** | rising |
| 60 Pa | 11.5 | **8.5** | peak ~8.5–9 |
| 300 Pa | 15.4 | **4.9** | past the peak, falling |
| 3500 Pa | 81.1 | **5.7** | well past it |
| 0.1 bar | 177.9 | — | ceiling is nine |

**178 W/m² against a measured maximum of nine.** Two things were wrong. The shortwave was absent,
and the Titan-fitted collision-induced term — a far-infrared continuum, beyond about 16 µm, which
is where a 94 K surface radiates and a 288 K one barely does — was being applied in front of the
whole Planck function on warm wet worlds. On any planet with water vapour that region is already
closed by the H₂O rotation band, which the code comment had claimed the quadratic in pCH₄ was
standing in for. It was not: fifteen millibars of methane over a temperate ocean is a perfectly
reachable state, and there it was worth a quarter of an optical depth. It is now masked by the
vapour column explicitly, so Titan (10⁻¹⁴ bar of vapour) and cold dry worlds keep it and Earth-like
ones do not.

Modern Earth's 1.8 ppm loses **12 mW/m²** of sunlight to this, so nothing in the present-day
calibration moved.

#### What it was breaking

Three times Earth's volcanism puts out more reductant than an Earth-like biosphere can outrun. The
air goes anoxic, and methane's sink — oxygen — goes with it. With no ceiling on the greenhouse, the
world then flashed into a **seven-hundred-degree wet runaway** and stayed there. The trace gives it
away: CO₂ was *falling* the whole time the temperature exploded.

It had been found before, pinned as a self-test, and diagnosed as a carbon-cycle problem needing the
atmospheric window this scheme does not have. That diagnosis was wrong; it was never the carbon
cycle. With the shortwave in, the same ladder is habitable end to end:

| outgassing | 1× | 2× | 2.6× | 2.8× | 3.5× | 5× | 8× |
|---|---|---|---|---|---|---|---|
| before | 15 °C | 19 | 20 | **521** | — | — | — |
| now | 15 °C | 19 | 20 | 13 | 16 | 20 | 26 |

The transition at 2.7× is still there and is still real — the air genuinely goes anoxic between 2.6×
and 2.8× — but it is now a **seven-kelvin cooling**, which is the direction the literature gives,
rather than a five-hundred-degree cliff.

#### And an abundance that had no equilibrium

Separately, the anoxic methane source was 2.2×10⁻³ kg/m²/yr against a photolytic ceiling of
1.6×10⁻³. Below **1.36 S⊕** the source beat every sink the planet had, so methane did not settle
anywhere — it accumulated for ever. Kharecha et al. 2005 put Archean biogenic fluxes at a third to
two and a half times modern; the model's anoxic boost was 2.7×, just outside that, and is now 1.5×,
which leaves an equilibrium anywhere above 0.76 S⊕.

The haze made it worse. Its shield divided the photon ceiling *as well as* multiplying the thin
lifetime, so haze cut methane's own sink, which grew more methane, which grew more haze, with
nothing anywhere to bring it back — a world at 3× volcanism climbed past **two bar** of methane with
80% of its sunlight stopped overhead and was still climbing at 60 Myr. The shield belongs on the
lifetime and not on the ceiling: haze does not reduce how much methane a planet loses, because the
haze **is made of the methane**. The photons it intercepts have already broken methane up higher in
the column, and the carbon leaves as tholin instead of as ethane. Titan is the anchor for that
ceiling precisely because its haze production is the observable, so dividing by the shield counted
the same haze twice.

### Organic haze and the anti-greenhouse

Ultraviolet light breaks methane into radicals that polymerise into a tholin smog — but only in a
*reducing* atmosphere. The haze switches on once **CH₄/CO₂ passes about 0.1** and free oxygen
destroys it outright (Trainer et al. 2006; Zerkle et al. 2012).

What makes it an *anti*-greenhouse is where the absorption happens. The haze soaks up sunlight high
up and is nearly transparent in the thermal infrared, so that energy goes straight back to space
instead of reaching the ground: it cools the surface without trapping anything in return. Titan is
the calibration point and the only world with a measured value — the model lands at **93.9 K against
an observed 94 K**, having been 105.8 K with no haze at all.

It also reproduces the Archean thermostat without being told to — but it is not the only thing doing
it, and for a long time it got all the credit. The turn happens **twice**, for two different reasons.

The first is the gas on its own: methane's near-infrared bands shade the ground with no smog involved
at all, and that peak sits at **60 Pa**, inside Eager-Nash's 30–300 Pa. By 300 Pa the world is 5.9 K
below its peak with 5% of the sunlight taken by methane and **none by haze**. Only well past that,
once CH₄/CO₂ clears 0.1, does the tholin haze switch on — and it is a much bigger hammer: by 55 mbar
it stops 38% of the sunlight and the surface is at −29.9 °C.

The self-test used to sweep 8–55 mbar, which is entirely past *both* turns, and so it only ever saw
the haze.

### What the atmosphere looks like

Two modes, switchable in-app, by `?atmosphere=realistic`, and remembered.

**Stylised** (default) draws a shell tens of percent of the planet's radius. That is a diagram, not
a photograph — and it is kept because it is a *useful* diagram: the point of the app is watching an
atmosphere change, and an honest one would be invisible at every pressure the model can produce.

**Realistic** draws the real thing: five scale heights, `H = RT/μg`, which is where the pressure has
fallen by about 150× and the air stops being visible. Earth comes out at **0.69% of its radius** — a
thin bright rim. It also stops pretending you can see through a deep atmosphere: Rayleigh scattering
alone veils Venus **97%**, and Titan's haze **94%**, so both show only their cloud tops, as they do
in every photograph ever taken of them.

| | scale height | stylised shell | realistic shell | veil |
|---|---|---|---|---|
| Earth | 8.8 km | 10% | 0.69% | 4% |
| Venus | 15.9 km | 42% | 1.31% | 97% |
| Mars | 11.1 km | 3.1% | 1.63% | 0% |
| Titan | 20.7 km | 12% | 4.0% | 94% |

### Locked worlds

A tidally locked planet has a permanent cold trap. Water sublimates from the day side, deposits on
the night side as glacier ice, and does not come back — so the planet keeps its whole inventory with
none of it liquid: a **Nightside-Trapped Desert**. What stops this happening everywhere is that ice
sheets *flow*: past a couple of kilometres they spread under their own weight and calve back, so the
night side can only hold so much. Trapping is therefore a small-inventory phenomenon (Menou 2013): a
world with an ocean keeps its sunlit sea and stays an **Eyeball**, a world with a few percent of one
loses all of it.

Between the two extremes sits the **Twilight World** — terminator habitability (Lobo et al. 2023).
The eye is past boiling and the night side is glacial, but a temperate ring of liquid water follows
the terminator right round the planet. It needs a land planet: water vapour is what carries heat
away from the substellar point, so a wetter world evens the temperatures out and crosses the runaway
limit as a whole instead of leaving a habitable band behind.

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

### What moves the habitable zone, and what does not

The edges are not properties of the star alone. Measured on this model, holding CO₂ fixed and asking
where the world stops keeping liquid water:

**Inner edge** (runaway), in S⊕:

| | S⊕ | literature |
|---|---|---|
| Earth, 24 h day, 1 ocean | 1.25 | ~1.2 (Wolf & Toon 2015) |
| slow rotator, 2000 h | 1.28 | up to ~2 (Yang, Cowan & Abbot 2014) |
| tidally locked | 1.23 | as above |
| 6 oceans, no land | 1.17 | wetter is worse |
| 0.1 ocean, land planet | **1.50** | ~1.5 (Abbot, Cowan & Ciesla 2012) |
| 0.02 ocean, desert | 1.48 | as low as 0.38 AU in the extreme (Zsom et al. 2013) |

**Outer edge** (global glaciation), in S⊕:

| obliquity | 0° | 23.5° | 70° |
|---|---|---|---|
| glaciates below | 0.90 | 0.95 | **0.78** |

So: **water inventory moves the inner edge properly** — a land planet holds out to 1.50 S⊕ against
Earth's 1.25, and the literature's ratio is 1.52/1.25. This is driven by the water a world actually
has, not by how much basin it has: `landFraction` is basin geometry and the coverage is worked out
from the inventory, which is why draining a world uncovers its sea floor. Abbot, Cowan & Ciesla 2012
found weathering and the habitable zone largely **insensitive to land fraction**, which is the same
statement from the other side.

**High obliquity resists glaciation**, 0.95 → 0.78 S⊕ at 70°, matching Armstrong et al. 2014 and
Colose et al. 2019. The 0°-versus-23.5° pair is the other way round (0.90 against 0.95), and that is
not a bug: at zero obliquity the poles are dark but the *equator* is brighter, and global glaciation
needs the ice line to reach the equator.

**Rotation rate barely moves anything**, and that is a real weakness. Yang, Cowan & Abbot 2014 find
the inner edge for slow rotators at nearly twice the flux, because strong substellar convection
builds a thick cloud deck. This model gets the direction (1.25 → 1.28) and about a twentieth of the
magnitude. A one-dimensional zonal scheme cannot grow that cloud deck; it approximates it through a
slowness term in the albedo.

There is no single "1.2 S⊕" here to hold to — 1.2 is Earth's number, for Earth's water, Earth's
rotation and Earth's obliquity.

### Volcanism is not industry

Worth stating because the difference is easy to lose. The fossil-carbon control is a **pulse** —
forty times the volcanic flux, out of a finite reserve, over four centuries, of which 44% stays
airborne because the ocean cannot turn over that fast. Volcanism is a **flux**, slow enough that the
whole ocean stays in step, so it goes through the ocean-and-crust buffer (κ = 50) and the silicate
thermostat has time to answer it.

That thermostat does answer. Raising outgassing from 1× to 8× moves equilibrium CO₂ by 93× and the
surface by **11 K**, not by hundreds — because weathering is kinetically limited here, going as
C^0.3 · exp(ΔT/13.7), so it rises to meet whatever the volcanoes produce. That is Foley 2015's
result: kinetically-limited weathering keeps a planet habitable across a wide range of degassing
rates, and it is only in the **supply-limited** regime — too little exposed land, too much carbon —
that the stabilising feedback fails.

Which is why weathering is deliberately *not* scaled by volcanic activity here. On a kinetically
limited planet the weathering rate is set by temperature and CO₂, not by how fast fresh rock
arrives; scaling the sink with the source would hold equilibrium CO₂ exactly where it was and make
the coupling a no-op. Fresh-basalt weatherability matters at the supply-limited end, which this
model does not enter.

## Known deviations from the literature

Stated plainly, because a model that hides these is less useful:

* **The carbon cycle has a cliff at about 2.7× Earth's outgassing, and it is not defensible.** An
  Earth-like world at 2.6× sits at 3100 ppm and 19.8 °C indefinitely. At 2.8× it holds 3400 ppm and
  20 °C for *fourteen million years* while CO₂ creeps up 50 ppm/Myr — then the last ice melts, the
  albedo feedback releases ~7 K, and the world staggers: partially re-glaciating to 61 % ice at
  −17 °C, recovering, overshooting to **1147 °C**, and finally settling at 521 °C in a steam
  greenhouse it cannot leave, because κ — the ocean-and-crust carbon buffer — has collapsed from 50
  to 1 and put fifty times the airborne carbon into the air at once.

  The **endpoint** is step-independent: 530.7 °C at a 2-Myr step cap, 532.5 °C at a 5000-year one.
  So the hot attractor is real. The **path** is not — different step sequences swing through
  different intermediate states, and a 1147 °C overshoot on the way to 521 °C is not physics.
  Endpoint robustness is not evidence that the transition is well posed.

  Nor is the threshold merely arguable. It tips at ~21,000 ppm, about 48× present. Goldblatt et al.
  (2013) put a *conceivable* CO₂-driven runaway at ~100× present; Wolf & Toon (2015) have Earth
  stable against runaway to 1.21× solar forcing, with a moist greenhouse arriving first — a stable
  state that loses its water over 10⁸ years, not a jump to 521 °C. This model offers no
  moist-greenhouse landing here at all; it goes straight to steam. Real Earth ran the Cretaceous and
  the Eocene at elevated outgassing and did not do this.

  It is a thermostat problem rather than a heat one, and fixing it means the atmospheric window this
  scheme does not have. It long predates internal heat — but internal heat is how you now meet it,
  since a melt boost of 2.7× arrives at **0.67 W/m²**, a seventh of Io's. A test pins it.

* **There is no outer edge to the habitable zone.** Kasting et al. (1993) put it at 1.67 AU — 0.36
  S⊕ — and it is set by a *maximum greenhouse*: CO₂ Rayleigh-scatters about 2.5× better than air, so
  past a few bar the scattering overtakes the greenhouse and adding more CO₂ **cools** the planet.
  Beyond that limit no amount of CO₂ lifts a world above freezing.

  This model has Rayleigh scattering but nowhere near enough of it, so the greenhouse never turns
  over: a world at 0.35 S⊕ reaches **+323 °C** under 30 bar of CO₂, where it should not reach 0 °C
  at any pressure. Nor are **CO₂ clouds modelled at all** — neither the scattering greenhouse of CO₂
  ice (Forget & Pierrehumbert 1997, which pushed the outer edge to 2.4 AU, and which Kitzmann 2016
  revised sharply downward once anisotropic scattering was done properly) nor their albedo. CO₂
  *surface* condensation is modelled, and drives the Mars-like collapse; condensation aloft is not.

  Same root cause as the snowball rows below: a semi-grey scheme with no atmospheric window, in
  which optical depth grows without limit. Reported by `calibrate.mjs` on every run.

* **Snowball deglaciation happens at ~10 mbar of CO₂**, against the 0.1–0.3 bar of published snowball
  studies, and snowballs therefore last **~0.2 Myr** rather than the observed few. Those are the same
  error twice: duration is threshold ÷ outgassing flux.

  It is worth spelling out how this hid for so long. `OUTGAS_EARTH` used to be set to 4×10⁻⁶ kg/m²/yr,
  some **130× below Earth's measured degassing rate**, tuned — the comment said so — to put the snowball
  *duration* back in the literature range. Two errors dividing out, one anchor green, and as a side
  effect nothing was watching, **the entire carbon cycle ran 100× too slow**: a CO₂ pulse took 90 Myr
  to clear instead of ~1. The duration anchor could not see it, because duration was the one thing the
  two errors conspired to get right.

  Outgassing is now on its measured value (5.2×10⁻⁴ kg/m²/yr, ~6×10¹² mol/yr), which costs nothing —
  the constant appears in both the source and the weathering sink, so it cancels out of every
  equilibrium and only sets rates. Earth's equilibrium moves by 0.01 °C. What it buys is a carbon
  thermostat that responds on the right timescale, and the price is that the threshold error is now
  visible in the duration instead of being cancelled. Both halves are reported every run as `GAP` rows
  in `tools/calibrate.mjs`.

  The root cause is that a semi-grey scheme has **no atmospheric window**: every watt leaving the
  ground is funnelled through one optical depth, so piling on CO₂ always works and eventually works
  arbitrarily well. Real snowballs are hard to leave because the 8–12 µm window keeps radiating no
  matter how much CO₂ you add.

  Adding that window has been tried twice and reverted twice. Both attempts are worth recording,
  because the second one answers a question the first only raised.

  **The first attempt** landed the threshold at 0.13–0.22 bar and improved the LGM from −4.5 K to
  −5.7 K against an observed −6.1, with all anchors passing. What it also did was make cold, dry,
  cloudless states far too stable: *colder → drier → window opens → colder* is a positive feedback
  with nothing to damp it. The Archean froze solid in 10 kyr and Titan fell to 71 K. Fixing the
  Archean did not save Titan, and fixing Titan needed a third continuum term.

  **The second attempt** fixed both of those, and failed for a better reason.

  Two things solve the first attempt's collapse. The share of a blackbody's emission that falls in
  the 8–12 µm window is *not a free parameter* — it is Planck, and it is strongly temperature
  dependent: 25.3 % at Earth's 288 K but **0.13 % at Titan's 95 K**. A constant window fraction hands
  a frigid world a window it has no business having; a Planck-weighted one closes itself as a world
  cools. Titan came through untouched at −182 °C. And clouds are the missing damper: `cloudCover()`
  saturates at 0.750 from 273 K up, so it holds the window shut by a fixed amount across the whole
  liquid-water range, then falls away below freezing where the window is actually wanted. Without the
  cloud term, Earth with CO₂ pinned at 427 ppm froze to **−42.6 °C and 100 % ice**; with it, the
  fixed-humidity OLR slope came to 1.63 W/m²/K against the old scheme's 1.73, and Earth stayed put.

  All 21 anchors could then be hit — Earth 238 W/m², Venus 161, Simpson–Nakajima 282 — with the
  window CO₂-blind on a snowball and shut on Venus, using the physically right quadratic
  (CO₂–CO₂ collision-induced) closure.

  **And the snowball threshold still only moved from 0.010 bar to 0.013.** That is the useful result,
  because it is not a tuning failure. Ask the fit to reduce CO₂'s leverage on a snowball — the OLR
  drop from 0.001 to 0.2 bar at 230 K, which is 26.5 W/m² in the shipped scheme — and driving it to
  13.2 W/m² drags the 280→560 ppm forcing from 3.82 W/m² down to **3.00, below its 3.3 floor**. One
  optical depth sets how well CO₂ works at 230 K and at 288 K *simultaneously*; a semi-grey scheme
  cannot decouple them. Nor can the window make up the difference, because at 230 K the 8–12 µm band
  carries at most 17.5 % of the emission. Deglaciation is not fixable here without spectral
  resolution, and no amount of refitting will change that.

  What the window did buy: the outer edge went from +67 °C to **+16 °C** at 0.35 S⊕ — the maximum
  greenhouse starting to work, though still not an edge. Against that, six downstream tests broke,
  including the methane-haze turnover, and the LGM moved *away* from observation (−4.45 → −3.42 K
  against −6.1). Not enough, so it went back again.

  **The third attempt did what the second said was needed: four spectral bands.** It is recorded in
  full because it *works*, and because it is where a fourth attempt should start.

  Bands at 0–8, 8–12 (the window), 12–18 (CO₂'s 15 µm band) and >18 µm (water's rotation band), each
  with its own optical depth, weighted by the true Planck share — one tabulated cumulative Planck
  function, so a band fraction is a difference of two lookups. The shares are the whole point:

  | | 0–8 | 8–12 | 12–18 | >18 |
  |---|---|---|---|---|
  | Titan 95 K | 0.0 | 0.1 | 2.8 | **97.0** |
  | snowball 230 K | 4.4 | 17.5 | 28.7 | **49.4** |
  | Earth 288 K | 12.1 | 25.3 | 28.2 | 34.4 |
  | Venus 737 K | **72.9** | 15.7 | 7.2 | 4.3 |

  On a snowball two thirds of the emission is in the window and the far infrared, where there is no
  water vapour and CO₂ has almost no grip; on Earth water closes the far infrared so CO₂'s own band
  carries proportionally more. **The structural limit breaks:** CO₂'s snowball leverage fell from
  39 K to 12 K per ten millibars *while* the 280→560 ppm forcing held at 3.71 W/m². The grey scheme
  provably could not do both.

  It costs **1.57×** the single-band scheme, not 4×, because the exponents are shared — one `pow` of
  the water amount and one of the CO₂ amount serve all four bands (band 2's water goes as `w³`,
  band 4's CO₂ as `u²`). Before that trick it was 2.9×, and `Math.pow` was all of it.

  Results: **the outer-edge gap closes outright** — a 0.35 S⊕ world goes from +67 °C to **−89 °C**,
  inside Kasting's maximum greenhouse, which no previous attempt approached. Snowball deglaciation
  0.010 → 0.022 bar and duration 0.20 → 0.46 Myr. Earth pre-industrial 13.96 °C, modern 16.2, ECS
  3.24 K, albedo 0.294 against CERES 0.293; Venus 705 K, Mars 210 K, Titan −181 °C, the Archean
  liquid, the runaway terminating properly.

  Two things sent it back:

  * **LGM −5.17 K against the anchor's −5 bound.** Not a tuning failure — *every* fit with
    pre-industrial inside 13.2–14.2 °C gives ≈ −5.2, because the LGM here is ice-albedo amplified
    rather than forcing-limited. It is 4% outside the anchor and closer to the observed −6.1 than the
    −4.45 that ships, which is worth knowing but is not the same as passing.
  * **The habitable zone's inner edge moved from ~1.25 to ~1.4 S⊕**, against a literature ~1.2
    (Wolf & Toon 2015). A steam atmosphere radiates too well through band 1 at 300–400 K, so the
    runaway starts too late, and the runaway-transient test fails on it. That is the one thing left
    to solve, and it is a band-1 water-opacity problem, not a structural one.

  The working fit, so a fourth attempt starts here rather than from scratch. Bands as above; each
  band's optical depth is multiplied by `pTot^0.30` except the window, which is pure continuum. With
  `w = pH2O^0.482077`, `u = pCO2^1.44915`, `L = ln(1 + pCO2/5.46e-6)`, `g = ln(1 + pCH4/6.9e-6)` and
  `cia = 1329.45·pCH4²·pTot`:

  ```
  tau1 = (0.531307·L + 0.689546·u + 0.479466·w + 0.00510601·g) · br
  tau2 =  5.2073·w³ + 0.00258412·pCO2² + cia
  tau3 = (0.104864·L + 200·u + 3.96754·w) · br
  tau4 = (13.85·w + 0.000054481·u²) · br + cia
  OLR  = Σ f_i(T)·σT⁴·[ (1−C)/(1+0.75·tau_i) + C/(1+0.75·(tau_i+0.1)) ]
  ```

  `C` is cloud fraction and 0.1 is the extra optical depth under cloud. `f_i(T)` are the Planck band
  shares. Every olr() call site must pass the cloud fraction, or the window is left spuriously wide
  open — `climate.js` has it as `a.cloud`, and the anchors in `calibrate.mjs` and `selftest.js` have
  to ask under Earth's actual two-thirds cover rather than clear sky.

  A degeneracy worth recording, because it cost an afternoon: **Venus cannot tell "opaque" from
  "absurdly opaque".** The fit happily left band 1's CO₂ continuum coefficient at 5059 where 0.7 was
  right — identical at 92 bar, both radiating nothing. On a hot world carrying 1.1 bar of CO₂ that
  blacked out the band holding 99% of the emission, dropped OLR by a factor of 590, and drove the
  runaway into the integrator's 4000 K clamp where it thrashed. Any fit against a saturated anchor
  needs an explicit bound on how opaque it is allowed to get.
* **The runaway transient is fast when the planet is pushed hard**, which is not a deviation but is
  worth stating plainly, because the ~10⁵ yr figure from Turbet et al. (2023) gets quoted as though
  it were universal. It is not: boiling an ocean is an energy problem. Vaporising an Earth ocean
  needs L·column = 6.6×10¹² J/m² of latent heat, so the time is that divided by the planet's net
  flux, and 10⁵ yr corresponds to a planet sitting about 2 W/m² over the limit. Measured against
  that prediction:

  | insolation | net flux | model | 6.6×10¹² J/m² ÷ flux |
  |---|---|---|---|
  | 1.2 S⊕ | 4 W/m² | had not finished | 5.1×10⁴ yr |
  | 1.416 S⊕ | 57 W/m² | 1.5×10³ yr | 3.7×10³ yr |
  | 2.6 S⊕ | 350 W/m² | 5.0×10² yr | 6.0×10² yr |

  The model runs a little fast because the net flux *grows* during the transient as the albedo
  drops, so the flux at onset understates the average. The scaling is the physical content and it
  holds.
* **Glacial cooling is −3.5 K at 190 ppm**, where the LGM was −6.1 K (Tierney et al. 2020). The
  difference is what the model is not given: the Laurentide and Fennoscandian ice sheets were a
  *prescribed* forcing set by ice dynamics and sea level, not something a zonal energy balance grows
  on its own, and glacial dust is absent too.
* **A biosphere can outrun the photon budget, and then methane has no equilibrium.**
  The photolytic ceiling is a flux, so a world whose methane source exceeds it accumulates without
  bound — there is no restoring force, and what stops it is the climate rather than the chemistry.
  The Super-Earth preset does exactly this: 2× Earth's volcanism on 3.5 Earth masses keeps it anoxic
  against its own biosphere, an anoxic biosphere makes 2.2×10⁻³ kg/m²/yr of methane against a
  1.6×10⁻³ ceiling, and it runs away. That is the model being self-consistent rather than
  misbehaving, but the ceiling constant is extrapolated from Titan across a hundredfold in
  insolation, so the *threshold* deserves less trust than the behaviour. It sits at outgassing ≈ 1.08
  for that world; below it the same planet is temperate at 22–24 °C.
* **Equilibrium warming for present-day CO₂ is 2.36 K**, which is inside AR6's likely range but near
  the top of it: an effective 3.9 K per doubling over 280→427 ppm, against the model's own 3.55
  measured at 280→560. The difference is ice-albedo nonlinearity — the pre-industrial base state has
  more ice to melt than the doubling test's average. It moved when pre-industrial Earth was given its
  real 0.72 ppm of methane instead of today's 1.9, which cooled both endpoints about half a kelvin.
* **The cloud feedback is +0.06 W/m²/K**, against AR6's +0.42 (+0.12 to +0.72). Cloud *amount* is now
  nearly flat where Earth sits, which is right; what is missing is the shift in cloud altitude and
  optical depth that supplies most of the observed positive feedback.
* **The Twilight World's land-planet requirement is imposed, not derived.** In this model a locked
  aquaplanet still comes out with a 164 K day-night contrast against a land planet's 198 K — a real
  difference, in the right direction, but nowhere near enough to close the habitable band on its
  own. A few hundredths of an ocean already saturate the air over a boiling eye, so the humidity
  limiter never binds and the two atmospheres stay within a factor of 1.6 in vapour. Closing the gap
  needs moisture transport and ocean circulation a one-dimensional diffusive model does not have,
  and steepening the latent-heat term to force it would wreck the Earth, Venus and Mars anchors. The
  classifier therefore carries Lobo et al.'s result rather than pretending to derive it.
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

Archer 2005, Lenton & Cannell 2002 (the fate of fossil carbon, recoverable reserves) · Sleep & Zahnle 2001 (carbon cycling through the mantle), Dasgupta & Hirschmann 2010 (the deep carbon cycle), Rushby et al. 2018 (carbonate-silicate cycling on other planet sizes) · Catling & Zahnle 2020, Pavlov et al. 2001, Zahnle 1986 (methane photochemistry, oxygen sinks) · Saunois et al. 2020 (the global methane budget) · Yung, Allen & Pinto 1984, Nixon et al. 2018 (Titan's methane and its ~10–100 Myr photochemical lifetime) · Brady & Gíslason 1997, Coogan & Dosso 2015, Krissansen-Totton & Catling 2017 (seafloor weathering) · Byrne & Goldblatt 2014 (Archean radiative forcing) · McKay, Pollack & Courtin 1991 (Titan's greenhouse and anti-greenhouse) · Trainer et al. 2006, Zerkle et al. 2012 (Archean organic haze) · Lobo, Shields, Palubski & Wolf 2023 (terminator habitability) · Menou 2013 (water-trapped worlds) · Abe-Ouchi et al. 2013 (ice-sheet hysteresis) · Goldblatt et al. 2013 (runaway radiation limit) · Kasting 1988 (moist/runaway greenhouse, water
loss) · Goldblatt & Watson 2012 · Turbet et al. 2023 (3-D runaway transition) · Wolf & Toon 2014 ·
Leconte et al. 2013 · Abe et al. 2011 (habitable zone limits for dry planets) · Yang et al. 2014
(slow rotators, substellar cloud deck) · Pierrehumbert, *Principles of Planetary Climate* ·
Turbet et al. 2017 (CO₂ condensation limits deglaciation) ·
Kasting, Whitmire & Reynolds 1993 (the maximum greenhouse and the outer edge) · Forget &
Pierrehumbert 1997, Kitzmann 2016 (the scattering greenhouse of CO₂ ice clouds, and its downward
revision) · Goldblatt et al. 2013, Wolf & Toon 2014/2015 (whether CO₂ alone can force a runaway) ·
Barnes et al. 2013 (tidal Venuses, the tidal greenhouse) · Barr, Dobos & Kiss 2018 (TRAPPIST-1
interiors, tidal heat fluxes and runaway thresholds) · Swain et al. 2021 (GJ 1132 b's atmosphere,
tidal dissipation and ultrareduced outgassing) · Davies & Davies 2010 (Earth's surface heat flux,
47 ± 2 TW) · Hirschmann 2018, Marty et al. 2020, Sun & Dasgupta 2023 (bulk silicate Earth carbon) ·
Byrne & Goldblatt 2015, *Diminished greenhouse warming from Archean methane due to solar absorption
lines*, Clim. Past 11:559, and Eager-Nash et al. 2023, JGR Atmospheres 2022JD037544 (methane's
shortwave absorption, the 8.5 W/m² ceiling on its forcing, and the cooling past it) · Kharecha,
Kasting & Siefert 2005 (an ecosystem model of the Archean methane flux, and the 100–35 000 ppmv it
can sustain) · Catling, Zahnle & McKay 2001 (biogenic methane, hydrogen escape and the irreversible
oxidation of the early Earth) · Haqq-Misra et al. 2016, *Limit cycles can reduce the width of the
habitable zone* (limit cycling at outgassing rates **below** modern Earth's) · Foley 2015 (plate
tectonic–climate coupling; kinetically- versus supply-limited weathering) · Abbot, Cowan & Ciesla
2012 (weathering and the habitable zone are largely insensitive to land fraction) · Zsom et al. 2013
(the minimum inner edge for hot desert worlds) · Armstrong et al. 2014, Colose et al. 2019 (high
obliquity resists glaciation) · Turbet et al. 2018 (TRAPPIST-1 climates and volatile fates) · Agol
et al. 2021 (TRAPPIST-1 masses, radii and insolations) · Bonfils et al. 2018 (GJ 1132 b) · Greene et
al. 2023 (TRAPPIST-1b's 503 K dayside, and no atmosphere).

## Licence

MIT
