# Planet Climate Sandbox

Build a terrestrial planet — its mass, water inventory, atmosphere, star and spin — and watch its
climate evolve over geological time into snowball, temperate, dune-world, eyeball, moist greenhouse,
runaway greenhouse and beyond.

**▶ [Play it here](https://m1omg.github.io/planet-climate-sandbox/)**

No build step, no dependencies, no CDN. Plain ES modules, raw WebGL2 for the planet, Canvas2D for
the charts.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node src/selftest.js            # 269 physics, coverage, determinism and control checks
node tools/calibrate.mjs        # 23 observational anchors + 3 reported known gaps
node tools/smoketest.mjs        # loads every module against a stub DOM
node tools/glslcheck.mjs        # parses the shaders with a GLSL ES 3.0 grammar
node tools/shadercompile.mjs    # compiles them on a real GL driver
node tools/gl1check.mjs [--png] # runs the WebGL1 path on a real headless driver
node tools/rendercheck.mjs      # CPU port of the shader; renders a PPM to look at
node tools/bakecheck.mjs [512]  # does the baked cube map reproduce the terrain?
node tools/bodycheck.mjs        # do the real surface maps reach both surface styles?
node tools/fallbackcheck.mjs    # does the software renderer draw a planet?
node tools/resumecheck.mjs      # does the tab survive being switched away from?
node tools/identity.mjs         # every preset's whole state, to compare against before a change
```

Shipping is one step longer here than on the stable site, and the difference is
worth understanding before the first push. GitHub Pages serves `main:/` directly,
so on that branch `git push origin main` *is* the deploy. This is a separate
branch, and its files are the site's `/altdev2/` subdirectory rather than its
root, so a push of this branch deploys nothing at all. `node tools/deploy.mjs
<site-root>` copies this build into a checkout of `main` and then hashes every
tracked file outside `altdev2/` to prove it moved none of them, which is not
ceremony: that checkout also carries the stable site, `/dev/`, and `/altdev/`,
which is somebody else's work in progress. Commit and push happen there.

That same layout is why the checks have to be run from the deployed copy rather
than from this branch on its own. `index.html` points `window.__assetBase` at
`../assets/`, because the 23 MB of surface maps at the root of the site are
shared by every build instead of copied into each one — only the Moon, which
belongs to this line of work, lives in this branch's own `assets/`. So one level
below a site root is not where this build is *published*, it is what this build
*is*, and `smoketest.mjs` and `glslcheck.mjs` resolve those maps exactly as the
browser does. Run `deploy.mjs` first and run the suite in the copy.

Verify after pushing by hash-matching a file you touched against
`https://m1omg.github.io/planet-climate-sandbox/altdev2/`, because a "built"
status is not proof the change is out there. See `CLAUDE.md`.

All twelve, before pushing — `calibrate.mjs` above all, because a change that
fixes one anchor almost always moves three others, and the three `GAP` rows are
known deviations that report every run rather than failing. `identity.mjs` is the
newest and answers the opposite question: not whether the anchors still hold, but
whether anything moved that had no business moving. It runs every preset ten
million years and prints the entire state vector at a precision that reads back
as the same double, so `diff` against a run from before the change is exact.
Much of what this branch adds is switched off on a rocky world by being zero —
no hydrogen, no envelope, no deep water — and adding an exact zero to a double is
exact, so those presets should come out not merely close but unchanged. A
fourteenth-decimal drift in one of them would pass every anchor above and mean
the new term is reaching code it was supposed to be dormant in. `node --check` parses files as CommonJS and will happily
miss ESM-only errors, which is exactly how a duplicate declaration once shipped a
blank page; the smoke test loads the real module graph and fails on it. The shader
lives in `src/render/glsl/` as real GLSL rather than a JavaScript template literal
for the same reason — a stray backtick there breaks the whole module silently.
Open with `?selftest=1` to run the same suite in the browser console.

Four more tools are **diagnostics rather than checks** — they measure and report, and nothing fails:
`tools/track.mjs <preset>` traces a world from its own start age to the present day every 250 Myr
(this is what the real-planet presets are tuned against, because their endpoints are observations);
`tools/throughput.mjs` reports simulated years per wall-clock second per preset, which is the number
the player actually feels and the one µs/step cannot tell you; `tools/bench.mjs` and
`tools/convergence.mjs` do the same for step cost and step-size independence.

`docs/climate-states.md` (and the same table as `docs/climate-states.ods`) writes down the exact
condition for every climate state the model can name.

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

`tools/calibrate.mjs` checks twenty-three anchors against published values in one run, and reports
three known gaps that are deliberately not fixed — snowball deglaciation CO₂ (0.010 bar against a
literature 0.08–0.4), snowball duration (0.22 Myr against 3–60) and the warmest a 0.35 S⊕ world can
be forced to (+67.7 °C, where the maximum greenhouse says it should not reach 0 °C):

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
* **Escape is slow, until the cold trap fails.** Hydrogen loss is the lesser of the diffusion limit
  (from the stratospheric mixing ratio) and the XUV energy limit. That mixing ratio is Kasting's
  power law while a cold trap exists, and simply the bulk water fraction once saturation at the
  tropopause exceeds the water actually present — because then nothing condenses at any altitude and
  the column is well mixed to the exobase. Extrapolating the power law past that point suppressed
  escape 290-fold on a planet in full runaway, and was why this model's Venus arrived at the present
  day at 928 K under nineteen bar of steam. It now arrives at 739 K under 93 bar, dry.
* **The carbonate–silicate thermostat.** Buffered by the ocean and reactive crust, it relaxes on
  ~1 Myr; inside a snowball the sink shuts off and volcanic CO₂ piles up for millions of years.

An adjustable clock (1 yr/s → 500 Myr/s) lets you watch any of it. Acceleration costs nothing in
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
temperate · waterbelt/slushball · hard snowball · eyeball · lobster · twilight world ·
nightside-trapped desert · dune/desert world · waterworld · Mars-like collapse · partial nightside freeze-out ·
nightside freeze-out · Titan-like · thin cold desert · baked desert · frozen desert · airless rock.

Twenty-two names down a nineteen-branch chain — `frozen` is reachable three ways — and **the exact
condition for every one is written down** in
[`docs/climate-states.md`](docs/climate-states.md) — with `docs/climate-states.ods` as the same
table in a spreadsheet. Three things about `classify()` are worth knowing before reading any single
condition: it is **one ordered chain and the first match wins**, so every branch carries the implicit
negation of everything above it; it has **no memory**, so a world sitting exactly on a threshold
flickers between two names; and `ice` is a statement about *temperature* while `water` is a statement
about *inventory*, which is why the dry branch has to be tested before the frozen ones.

### Slovenčina, and how the translation is arranged

The page ships in **English and Slovak**. Which one you get is decided in this order: a choice you
made before (kept in this build's own storage), then `navigator.languages` — the browser's list, in
preference order — then English. The **EN / SK** button beside the renderer switches it at any time
and remembers the choice; it does not reload, reset or otherwise disturb the running world.

Only the first language in the list that this page can actually speak is taken, and a near miss does
not count: a browser asking for `cs, en` gets English, not Slovak. Guessing across languages because
they look similar is how Czechs get served Slovak.

Two kinds of lookup, because there are two kinds of string:

```js
t('Settle')                        // UI text, keyed by the English itself
tx('states', 'snowball', 'name')   // content, keyed by the id it belongs to
```

Keying the UI by its own English source means there is no `ui.timebar.settle` indirection to read
past and no key file to keep in step; a string with no entry falls through to English, which is a
usable page rather than a blank one. Content — climate states, presets, scenarios — is keyed by id,
because a preset's name is a name rather than a label, and because two states may share an English
word and must not be forced to share a Slovak one.

**The model does not know a language exists.** `classify()` still returns `id: 'snowball'` with its
English name beside it, and every assertion in `selftest.js` still reads that. A dictionary that
reached into the physics would make two hundred and fifty checks language-dependent, which is a poor
trade for a model whose entire output is prose about planets.

The one place text is genuinely *composed* rather than looked up is `reasonText()` — the line under
the state name, which picks its clauses from what the planet is doing. It cannot be a dictionary
entry, because it is six or seven of them joined by the physics. So it takes a **translator as an
argument**: `reasonText(w, st, tp)` from the UI, and a default that formats the English exactly as
before for every headless caller. `classify.js` imports nothing from `src/game/`, and the tests that
call it with two arguments never notice.

That line was English on a Slovak page for as long as the translation existed, and so was every label
on the charts, because both are built after boot and neither is a DOM text node `applyStatic()` can
walk. Coverage counted dictionary keys, which is why it reported full coverage the whole time.
`smoketest.mjs` now walks a spread of worlds through `reasonText()` with a spy in the translator slot
and fails on any clause the dictionary has no entry for — and rejects a bare string literal inside a
`label(ctx, …)` call, since chart text is drawn to a canvas where nothing else can see it.

The static page translates **in place**: `applyStatic()` walks the text nodes and the
`title`/`aria-label`/`placeholder` attributes, caching the English on each one the first time it sees
it. So switching back is a restore rather than a second translation, no markup needs a `data-i18n`
attribute, and the slider labels and their notes come along without being enumerated anywhere. What
cannot work that way is anything assembled from data after boot — the preset and scenario chips, the
climate log, every line of the readout — and that is what `relabel()` rebuilds.

`smoketest.mjs` fails if the Slovak dictionary falls out of step with the model: a state, preset or
scenario with no translation, or a translation for an id that no longer exists. It also checks that
the switch is wired, and that the translator actually switches both ways and falls back to English on
a string it does not know.

One check is about a word rather than a mechanism. **A runaway greenhouse is not an escape.** Slovak
`únik` is what hydrogen does, and what an atmosphere does to a solar wind — both of which this model
tracks separately and displays a few centimetres away. Using it for the runaway as well said the
planet was leaking when what it is doing is running away with itself, so the runaway is
*nekontrolovateľný skleníkový efekt* throughout and `smoketest.mjs` fails if `únik` ever appears in a
translation of a string with "runaway" in it.

That name is thirty-nine characters, against nineteen for "Dry Runaway Greenhouse", and it exposed a
layout assumption that had been wrong all along: the readout tiles and the climate cards were
`white-space: nowrap` with an ellipsis. A truncated label names nothing — `REZERVA DO NEKONTROL…` —
and the tiles were also forcing themselves wider than the panel that holds them, which is why the
right-hand column ran off the edge of a narrow window and why `MORSKÝ ĽAD / PEVNINSK…` was clipped in
English too. Both now wrap instead, and `browsercheck.mjs` lays **every** climate name out in a real
card in Chrome and fails if one overflows — measured, not assumed, because the only honest way to
know whether a string fits is to let the browser try to fit it.

The one label that still cannot fit is the readout's `Runaway margin`: the word
*nekontrolovateľného* alone is 130px in a 136px tile, so no wrapping saves it. That tile reads
*Rezerva do prekročenia* and carries the full sentence as a tooltip.

### A timeline, and the run's own account of itself

The temperature chart is the time machine — drag along it and the world goes back to where it was.
For a long time it was almost unusable as one, because the axis was **logarithmic**. As a picture that
is defensible: the early part of a run is where the fast things happen. As a control it is not. On a
4.567 Gyr world the log axis gave the first half-billion years nine tenths of the width and squeezed
the remaining four billion into the last tenth, so **five millimetres near the right-hand end was
about two billion years** and there was no way to aim at anything.

It is linear now — a timeline, where equal distances are equal spans of history — and the resolution
that costs at the early end is given back on demand: **scroll to zoom, shift-scroll to pan,
double-click for the whole run**. A pixel is 9 Myr on a 4.567 Gyr world at 1×, and 140 kyr at 64×.
The zoom anchors on the moment under the pointer rather than on the right-hand edge, because zooming
about the edge walks whatever you were looking at off the screen, which is the thing that makes a
zoom feel broken.

Three things are drawn on that timeline. The trace itself; **milestone flags**, because a checkpoint
you cannot see is one whose time you have to remember; and a band of **climate epochs** along the
bottom, in each state's own colour.

**Milestones** were already multiple, renameable and individually removable. What they lacked was a
way back: the time is now a button, and pressing it puts the world where it was when you dropped the
flag. There is a *Clear all* beside the list. A mark auto-named from the climate follows the language
switch — it stores the state's id, not the string — while one you have renamed keeps what you typed.

**Climate epochs** are new. Every state the model can reach already had a name and a colour; what was
missing was the record of *when*, so a world that had been through four climates could only tell you
the one it was in. The panel lists them newest-first with the span of each, the open one counting up,
and ↶ goes back to where any of them began. They travel in save slots, and a rewind reopens the span
you land in and drops the ones that have not happened on that branch — the same rule the milestones
and the temperature history already followed.

**The epoch you are living through counts up.** It is the only row on that list whose number is still
moving, and the list is only rebuilt when the climate *changes* — so its duration was written once, at
the instant the epoch began, when it is zero by construction, and then left there. Every finished
epoch read correctly and the one you were actually in read `0.0 yr` for as long as it lasted. It is
held by reference and retimed on the readout's own clock: one string per tick rather than a rebuilt
list ten times a second.

**And the list does not survive a clock that restarts.** Loading a preset resets time to zero, and
continuing the record across that produced spans which closed before they opened — a runaway recorded
as beginning at 190 years and ending at 0, because the open epoch was closed with the *new* world's
clock. A clock that has gone backwards past the start of the open span is a different run, and the
list starts again. A rewind *inside* one run is a different thing and is handled separately: that one
reopens the span you landed in and drops what has not happened on that branch.

One thing about where that record is written. The obvious place is the readout, which is where
`classify()` is already called — and it is wrong, because the readout runs at 10 Hz and **a transition
that finished between two of its ticks would never be recorded at all**. A world would list itself as
temperate and then as a runaway with nothing in between, having in fact spent a fifth of a second
passing through the moist greenhouse. It is written on the frame loop instead. `classify()` is a chain
of comparisons over numbers the diagnostics already hold, so asking it sixty times a second costs
nothing worth measuring against a step of the model.

### Water past its critical point is not an ocean

Above 647 K there is no liquid phase. Not a little liquid, not liquid if you press hard enough —
none, at any pressure, by definition of the critical point. So a world past it cannot have a sea, and
every accounting of its water has to say so: the inventory chart, the flooded fraction the renderer
draws oceans from, and the state it is classified into.

It did not. **TRAPPIST-1b at 1 Gyr sits at 700 K under 222 bar and booked four of its five oceans as
liquid water** — blue seas and continents drawn on a supercritical planet, "ocean 82%" on the
inventory chart, and immediately beside it a composition line correctly reading 83% H₂O·sc.

`psatH2O` returns a finite pseudo-value above the critical point. That is right for the two things
the rest of the model asks of it — its slope, and ratios of itself at nearby temperatures — and wrong
as a *ceiling* on how much water the air can hold, which is what the vapour column used it for. At
700 K it says 337 bar, which holds less than one of those five oceans; the other four had nowhere to
go but the surface. The ceiling is lifted where it is applied rather than inside the function, so
nothing else changes.

It hid because it comes right again by accident further up: by 1400 K the pseudo-value is large
enough to hold a whole inventory anyway, so every test that sampled a *developed* runaway passed.
The check now samples one year in, just past the critical point, which is where it is wrong.

Two things followed from the fix, both of which are the model being more honest rather than less:

- A world with an ocean and 80 W/m² of internal heat — 870× Earth's — now ends as a **270 bar
  supercritical envelope at 830 K** instead of a hot world with a sea. Its temperature is steady to
  ten kelvin over half a billion years while its instantaneous energy balance wanders a few W/m²
  either side of zero, because an envelope whose opacity moves with its own temperature is stiff.
  Settle has a round cap, so it stops either way.
- The wet-runaway convergence check was measuring the *spread* of the imbalance over twelve steps and
  calling anything over 1 W/m² a flip-flop. With the envelope's thermal inertia the world is still
  approaching equilibrium after 30 kyr — smoothly, monotonically, from −2.19 to −0.22 W/m², with the
  flooded fraction pinned at zero throughout. A spread bound cannot tell that apart from the
  period-two oscillation it was written to catch, so it counts reversals now.

### Frame-rate independence

Physics advances on simulated time only. Elapsed real time buys *credit*; steps are sized purely
from the state of the planet, and a step is taken only when there is credit to pay for it in full.
Because the step sequence never depends on where frame boundaries fell, 90 fps, 15 fps and randomly
paced frames with stalls trace **bit-identical** trajectories (verified: max ΔT = 0.00 K).

The solver is semi-implicit and linearised over both the longwave *and* shortwave feedbacks, with a
quasi-static shortcut that strides over quiet epochs — gated off wherever the radiative damping goes
negative, since that is exactly a runaway and striding over it would invent equilibria the planet
does not have.

There is a second gate for **hot, tidally locked land planets with a small water inventory**. A
reported 0.0327-ocean world had a formally quiet temperature solve while its nightside ice sheet was
still moving humidity and albedo between two branches. The shortcut multiplied a 0.37-year accuracy
step into 253 years and made it cycle forever between Twilight and Baked Desert. That narrow regime
now limits the shortcut to 46× rather than 4000×: the 400 kyr regression stays on the fixed-fine
Twilight trajectory with no state flips, while ordinary locked ocean worlds keep the fast path.

### Watching a tipping instead of skipping over it

At the 10 Myr/s this is mostly played at, a runaway greenhouse takes **0.05 seconds** of wall clock
and a glaciation 0.02 — the planet is temperate, and then it is not, and the transition every one of
these worlds is *about* is the one thing you never get to see.

The **ease** switch beside the clock holds the clock to a fixed `|d ln T|` per wall-clock second. Log
temperature rather than kelvin, because the two events are not the same size: a snowball is a 33 K
fall and a runaway a 212 K climb, so any fixed number of degrees a second either flicks past the
first or takes two minutes over the second. In log they are 0.14 and 1.2, and one setting serves
both — **5.8 s and 1.7 s** respectively, and the same 5.8 s if you ask for 100 Myr/s instead of 10.

It acts *inside* the frame rather than turning the rate down for the next one. That is not a
refinement: one frame at 10 Myr/s is 160 000 years and the whole runaway is 500, so a controller
watching the previous frame has nothing left to slow down by the time it reacts — measured at three
frames from temperate to boiling with the feedback loop running. The budget is spent step by step and
the frame stops when it runs out. A settled Earth with the governor armed runs its full hundred
million years in ten seconds and never notices it is there.

**It took three versions to get right, and the first two are worth writing down, because neither
failure was in the physics.**

The original was a per-frame *allowance*: steps were spent against a budget of `|d ln T|` until it ran
out, then the frame stopped. One solver step through a transition moves further than one frame's
allowance, so the frame always overshot; the leftover credit was then thrown away, deliberately, so
that banking time the governor had just declined to spend could not hand it back as a burst. Zero was
too far. The next frame could not afford a single step, so it advanced nothing; with nothing advanced
there was no change to measure; with no measured change the governor stopped asking for finer steps,
so the step it could eventually afford was *bigger*. **76% of frames advancing nothing, in runs of up
to nine, separated by jumps of a million years** — not a slowed clock but a stuttering one.

Half of that was never the ease at all. `if (credit < dt) break` refused to move until a whole step
was affordable, and whenever the solver would allow a step larger than one frame's credit — most of a
calm world's life — the frame took no step and banked instead. The clock ran in bursts with dead
frames between them at *every* rate, governor or no governor. A frame now spends the credit it
actually has: a `dt` below `maxStep` is the accurate direction, and it honours the rate exactly rather
than on average.

The second version fixed the dead frames and replaced the alternation with a milder one, because a
frame cut off at its budget advances a different amount from a frame that runs full, and that
difference *is* the alternation. Hysteresis narrowed it. A continuous dial narrowed it. Not banking
the declined time narrowed it. None of them removed it, because the cause was the cut.

**The third is a rate limiter, and it reads the planet rather than the last frame.** What forced the
cut was lag — at 10 Myr/s a frame is 160 000 years and a whole runaway is 500 — and that argument does
not apply to a controller that looks at the tendency *before* stepping. `maxStep` computes it anyway.
Two quantities come out of the same linearisation the solver already builds:

- **How far this climate can still go**, `ΔT·C/d`, damped by radiation *and lateral transport*. Using
  radiation alone made the reach fifteen times too large on a tidally locked world, where transport is
  what carries the day side's heat to the night side, and held TRAPPIST-1e to 8% of a rate it did not
  need holding at.
- **How long it takes to get there**, `C/d`. A world whose entire remaining reach is below the target
  is never held back at all, however fast the clock is set — which is most worlds, most of the time,
  and is the property every earlier version got wrong in one direction or the other.

A runaway is not that, and needs its own term: its fixed point runs away in front of it, so the
instantaneous offset stays small while the planet travels 200 K. Reach alone let it past at full
speed. That one is measured rather than predicted, which is safe *here* in a way it was not before —
a rate limiter runs its frames at roughly constant size, so the reading has a fixed point instead of
an oscillation. A wide backstop inside the frame catches the very first onset, once, before the
measurement exists; it has thirty times the budget in hand, so ordinary drift never trips it.

Two smaller things, both of which silently undid the rest. The tendency is kelvin per **second** and
the governor wants per year. And the anti-stall floor was `rate × 1e-4` — proportional, so at 10 Myr/s
it was a thousand years a second when the limiter had asked for less than one, and the runaway went by
in a third of a second with every dial reading as though it were engaged. It is absolute now.

**Measured, across every preset at 0.1, 1 and 10 Myr/s: no frame advances nothing, no run alternates,
and no world is held back that would not have crossed the screen faster than the target.** The
Archean is held about 10% at 10 Myr/s and should be — it carries a real equilibrium offset, a cold
world under a faint sun with a tenth of a bar of CO₂, a long way from where it is going.

One number moved with the fix. The old governor asked for 5%/s and delivered a 2.8 s runaway where
5%/s means eleven, because most of the limiting it thought it was doing never happened. A governor
that hits its target is a slower governor at the same setting, so the setting moved with it: **10%/s**
puts the glaciation at the 1.3 s it always took and the runaway at 5.8 s, both watchable and neither
tedious, and the ratio between them is now simply the ratio of their log-temperature spans.

It is a governor on measured change, not a detector for two named events, so it also catches a CO₂
collapse, a nightside freeze-out and anything else this model can do that a list would have missed.

While it is holding the clock back the rate field shows **what the world is actually advancing at**,
not what was asked for — a readout saying "10 Myr / s" while the planet crawls through a tipping is
lying about the one moment you are watching most closely.

### A sea does not freeze between two frames

The drawn sea ice is a 25 K ramp and perfectly smooth *in temperature*. What is not smooth is how
fast a planet crosses it: measured at 100 kyr/s, a world at the ice edge goes from open water to
frozen over with a per-frame jump of **0.96** — the whole ramp inside one frame, because one frame is
sixteen hundred simulated years. The planet really did freeze that fast; the picture teleporting is
still wrong, and it is the same complaint as a runaway happening between two frames.

So it eases at a fixed rate in **seconds**, not in simulated time: a full swing takes about two
thirds of a second however fast the clock is running, and every readout keeps showing the true state
throughout. Loading a different world re-seeds rather than eases, because a snowball must be a
snowball on its first frame instead of freezing over in front of you.

Below the **triple point** a cold basin is drawn as an ice field however the temperature ramp reads.
There is no liquid water at any pressure under 611.7 Pa, so drawing one as open blue sea was the one
thing the phase-limit physics exists to rule out. The readout switches from "land / ocean" to
"land / ice" at the same line.

The first version of that floor said *whatever the temperature says*, full stop, and that was wrong
in the other direction: it pinned Mars's drawn ice at 0.268 at any temperature, including +27 °C,
where 620 Pa of air holds its water as **vapour** — which is exactly where `partitionWater()` sends
it. The floor now carries the same condition the physics does, graded on the coldest band, so it
binds on a cold thin world and lets go of a warm one.

### Three clocks and a flag

`age` is how old the object is *including everything before the simulation started* — an Archean
preset is already 1.15 Gyr old at t = 0, and a bar that only said "elapsed 2 Gyr" was hiding that the
planet was 3.15 billion years old. `elapsed` is the run. `since` counts from the last **milestone**,
dropped with the ⚑ button and named after whatever the planet was at that moment, so you can time an
event while you are watching it. Milestones travel in a save, are cleared by a reset, and a rewind
along the temperature history drops the ones that are now in the future.

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
geometry* — a reference high-ground share at Earth-like water — and the actual coverage follows
from the water that is really there, through a hypsometric curve (`src/physics/hypsometry.js`):

```
broad   = (1 − L) · (W_basin / 1 EO)^0.25
flooded = clamp(max(min(broad, W_basin / (ρ · 50 m)), W_basin / (ρ · 20 km)), 0, 1)
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

The two depth bounds prevent opposite absurdities. Fifty metres stops a trace inventory spreading
into a planet-wide film; twenty kilometres stops any inventory being hidden in a zero-area,
infinite-depth basin. The latter is deliberately generous rocky-world relief. It leaves every
shipped starting state unchanged, but a maximally continental Earth-size world now floods 13.7% at
1 EO and is entirely submerged by 7.3 EO. The `100%` control endpoint therefore means maximum
**high-ground bias**, not magical terrain that can contain unlimited water without a surface.

Venus's basin geometry remains **0.8**, matching its broad lowland plains, and its dry preset remains
dry because `water: 0` is what makes Venus dry. Classification and continental weathering follow the
derived surface: once water overtops the reference continents, the world is labelled from the ocean
actually shown and submerged rock no longer weathers as exposed land.

`W_basin` counts liquid ocean **plus sea ice**, because ice floats and still fills its basin, but
**not** water vapour. So boiling an ocean uncovers its floor and land climbs to 100%, while freezing
one does not. The exponent is calibrated against real hypsometry: halving Earth's ocean drops the
flooded area only ~15%, because the abyssal plains are nearly flat.

A sea also has to be deep enough to be a sea. The power law above is calibrated in the middle of its
range, and taken to the limit it is badly wrong: it floods 1.6% of a planet with a *millionth* of an
ocean, which works out at twenty centimetres deep. Since the renderer draws whatever fraction this
returns as open water, a world the model itself called bone dry came out with blue seas along its
terminator. The deepest basin has a finite area, so as the water goes the flooded fraction must fall
in proportion to the volume rather than to its fourth root. Requiring a mean depth of at least 50 m
imposes that dry-end limit; the 20 km ceiling is its wet-end counterpart.

### Real worlds

Earth, the Moon, Mars, Venus and Titan carry their **actual surface maps**, loaded when you pick that
preset. The Moon uses NASA SVS's 2048×1024 LRO WAC natural-colour mosaic and keeps its map inside this
build rather than the shared root asset set.

Geography is not a function of climate — warming Earth does not move its continents — so the map
stays put while you drag every slider, and only changes when you load a different world. Nothing has
to cross-fade as the climate runs, which is the whole reason this works.

Earth also carries its **real topography**, remapped at build time so its height distribution matches
the procedural terrain's. That means the same sea-level function serves both, and Earth's coastline
lands where it belongs: asking for 29% land draws 29.0%, with all ten test landmarks — the Sahara,
Kansas, the Amazon, mid-Pacific, Antarctica and the rest — on the right side of the water. Because
the map keeps its bathymetry (70% of the globe spread across the sub-sea levels, not clipped flat),
**sea level really moves**: drain the oceans and the continental shelves appear.

Mapped topography uses a much narrower shoreline blend than invented terrain. The procedural ramp
made smooth fictional coasts, but on Earth's resolved DEM it blended too wide a band and reduced a
30.0% mapped-land target to 25.2%, visually flooding low plains as soon as the clock moved. The
measured mapped ramp preserves **29.7% effective land**, while still following the simulated sea
level as a planet dries or floods; the broad ramp remains only on procedural worlds.

The photograph's ocean is not treated as permanent blue paint. Its reference shoreline is recovered
from the same DEM; wherever the simulated sea has retreated below it, the renderer reveals modelled
dark seabed instead. This is why a zero-ocean Earth no longer keeps blue copies of the Indian and
Atlantic oceans on what the model correctly says is dry ground.

Equirectangular longitude is sampled as `atan(x,z)`: with the default camera looking down +Z, east
therefore moves to screen-right. The old `atan(z,x)` exchanged the axes and mirrored every continent,
which is why India appeared west of Africa even though the source JPEG itself was correct.

Switching between a real world and an invented one **dissolves region by region** rather than
blending everywhere, following the terrain's own detail field. That is not a stylistic choice. Two
worlds disagree about land-versus-sea over about 41% of the globe, so fading the *pictures* is a
double exposure with two sets of coastlines; and blending two height fields everywhere flattens the
relief and drains the land (measured: 30% → 18% at the midpoint). A regional dissolve makes every
point on the globe somebody's real coastline throughout, and holds the land fraction to within a
point.

**Mars carries its real topography too**, from the MOLA MEGDR grid — signed 16-bit metres above the
areoid, straight off the NASA PDS, put through the same histogram match as Earth's. It checks out
against the planet: 21171 m at 17.3 N, 227.0 E is Olympus Mons, −8177 m at 32.8 S, 62.2 E is the
Hellas floor. Because the match preserves hypsometry, giving Noachian Mars an ocean floods the
**northern lowlands** — Vastitas Borealis, where the shoreline hypothesis puts it — rather than an
invented basin.

The one non-obvious part is the longitude origin, and getting it wrong puts Olympus Mons in Elysium.
MEGDR starts at 0 °E; the colour map is centred on 0, so its left edge is 180 °E, and the two are
rolled half a width apart. That was settled by stacking the two images and looking. An
albedo–elevation cross-correlation does **not** settle it: it answers 244 °E with a sharp peak and
r = −0.40, because what varies across Mars's face is dust, not relief.

Venus and Titan keep procedural relief under their real albedo — Magellan's altimetry is not a clean
grayscale DEM at this size and Titan's is barely mapped — and a plausible-looking but wrong surface
is worse than an honest invented one. Sources and licences are in `assets/bodies/CREDITS.md`; the
build is `tools/buildbodies.py`.

**Noachian Mars is Mars**, and now says so: it used to render as an invented world with a random
seed. Almost everything on that map is older than the epoch — the crustal dichotomy, Hellas, Argyre
and the whole cratered southern highlands are Noachian-aged — so the shape is right and the rust is
the caveat, being billions of years of oxidation this world has not had yet.

**Both early Venuses and the Archean deliberately get no map**, for the same reason: the real
surface is *younger than the preset*. Every feature on the Magellan map post-dates Venus's global
resurfacing 715 Myr ago, which that world has not reached yet and may never; and the Archean had
perhaps a tenth of today's continental area, nowhere near where the coastlines are now. A procedural
world is honest about not knowing. Earth's map on an Archean planet would be a claim, and a false one.

**Ancient Moon** does use the lunar mosaic. The broad maria were being emplaced during the preset's
epoch, so the present map is an orientation aid rather than a claim that every lava flow already
existed. Needham & Kring's eruption inventory supplies 0.01 bar of CO/S-dominated gas and
1.5×10⁻⁷ Earth oceans of water. Because this model has no CO or sulfur reservoir, radiatively weak
N₂ is labelled as an explicit proxy; its escape multiplier is fitted to the paper's roughly 70 Myr
atmospheric lifetime, while most of the tiny water inventory survives as cold-trapped ice.

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

#### Two hot oceans that are hot for opposite reasons, and one that stops being an ocean

**Hot Ocean · CO₂** and **Hot Ocean · Starlight** are the same temperature and have nothing else in
common. Both are settled — measured at 100 Myr with the imbalance at −0.01 and −0.15 W/m² — and both
still have their seas:

| heated by | starlight | volcanism | equilibrium CO₂ | surface |
|---|---|---|---|---|
| **its own air** | 1.000 S⊕ | 4.5× | **0.091 bar** | 49.5 °C |
| **its star** | 1.256 S⊕ | 0× | **~0 ppm** | 49.0 °C |

Half a degree apart and effectively all the carbon dioxide on the first world. Both also set basin
geometry to zero: these presets are global oceans, not Earth-shaped continents under a misleading
name. That is the
carbonate–silicate thermostat seen from both sides. Heat a planet from outside and it weathers
faster, strips its own greenhouse away, and bakes anyway; heat one from inside and the greenhouse
has to be erupted back continuously or the planet cools. With no continents, seafloor weathering is
the first world's only carbon thermostat; 4.5× volcanism holds it near 50 °C without exhausting the
finite mantle reservoir during the checked 100 Myr run.

**Over the Edge** is that second world with the star turned up until there is no equilibrium left,
and the edge turns out to be **one part in thirteen hundred**:

| | 1.338 S⊕ | 1.339 S⊕ |
|---|---|---|
| after 100 Myr | 47.2 °C, ocean intact | — |
| after 13,400 yr | — | **ocean gone**, 603 °C |

For its first millennium it looks like the two above — a warm sea, no ice, nothing visibly wrong.
Then absorbed sunlight is past what the atmosphere can radiate at any temperature, every kelvin
evaporates more ocean, and the only stopping point is an empty sea bed. It takes thousands of years
rather than happening at once because boiling an ocean costs 6.6×10¹² J/m² of latent heat, and the
transient is that divided by the net flux. **Turn the ease switch on**, or at anything above 10 kyr/s
it happens between two frames.

### Stars that brighten the way stars brighten

The "brightening star" box used to add a flat 10% per Gyr, compounded. The Sun does not do that, and
neither does anything else. Gough's (1981) track for the Sun is

```
L(t)/L_now = 1 / (1 + 0.4 (1 - t/4.567 Gyr))
```

— 71% at zero age, 77% in the Archean, and **steepening**: 6.7%/Gyr then against 8.8%/Gyr now.

That is not a detail. Every solar preset here carries a `startAge` picked off Gough's curve to match
its own insolation, so running them forward on a *different* curve left them missing the present day.
The Archean starts at 0.77 S⊕ and reached 1.067 rather than 1.000; Noachian Mars starts at 0.32 and
reached 0.467 against the 0.431 Mars actually gets. On the real curve both land exactly where the
planet they represent is now, and that agreement is a check rather than a coincidence.

The setting is now a **multiplier on the star's own track**, where 1 means "this star, brightening the
way it does". Main-sequence lifetime goes as `M/L ~ M^-2.5`, and mass follows temperature as
`M ~ T^2.51` across the dwarf sequence (fitted to Pecaut & Mamajek), so lifetime goes as `T^-6.28` —
a ferociously steep dependence, and the whole point:

| star | T_eff | main sequence | brightening now |
|---|---|---|---|
| the Sun | 5772 K | 10 Gyr | 8.8%/Gyr |
| an F5 | 6500 K | 4.7 Gyr | 21%/Gyr |
| GJ 1132 | 3270 K | 355 Gyr | 0.18%/Gyr |
| TRAPPIST-1 | 2566 K | 1500 Gyr | 0.04%/Gyr |

One ticked box, four different stars. A rate could not do that, because one number cannot be right for
two stars — or, as it turns out, for one star at two different ages. "Hold Back the Runaway" needed a
star that brightens 26%/Gyr and used to be *given* one; it is now an F at 6500 K, 2.75 Gyr old, which
**has** one.

### The other half of a star's life, which is not its luminosity

A star's extreme ultraviolet does not follow its brightness — it runs the opposite way. The star gets
brighter and its XUV gets weaker, and for anything to do with escape it is the second that decides
whether a planet keeps its air. Ribas et al. (2005) fit solar analogues at `F_XUV ∝ t^−1.23`, which
puts the Sun at half a billion years some fifteen times as harsh as it is now.

But not from birth. A young star rotates fast enough that its dynamo is running flat out and the ratio
**saturates** — it cannot climb further however much faster the star spins (Wright et al. 2011, below
a Rossby number of about 0.13). The decline only starts once the star has spun down, and how long that
takes is a property of the star rather than a constant, because a fully convective late M dwarf sheds
angular momentum far more slowly than a G dwarf does:

How long is **measured, not fitted**. It was fitted once — 0.1 Gyr for the Sun times `(T/T☉)^−3.3` —
and the number that fell out for a late M dwarf, about 1.5 Gyr, contradicted the observation the
presets are anchored to. The contradiction is the kind a model can carry for years without anything
looking wrong:

> TRAPPIST-1b and 1e carry a **measured** present-day XUV of 206× solar (Wheatley et al. 2017:
> `Lx/Lbol` = 2–4×10⁻⁴, and more again in the EUV). Run that back up a `t^−1.23` curve to a saturation
> that ended at 1.5 Gyr and it implies the star used to be **843× solar** — almost six times the
> saturation ceiling of `log(Lx/Lbol) ≈ −3.3`, a ratio no star exceeds because it is set by the dynamo
> running flat out. The curve was claiming a history the star could not have had. GJ 1132 b was over
> by four times.

The table is West et al. (2008) instead, who measure activity lifetimes across the M sequence from
38 000 stars, with the solar X-ray timescale at the hot end. A power law cannot fit it — the sequence
flattens between M5 and M6, and fits through M4 and through M7 disagree by a factor of two either
side.

| star | saturated until |
|---|---|
| the Sun | 0.10 Gyr |
| M0, 3870 K | 0.80 Gyr |
| GJ 1132, 3270 K | 3.75 Gyr |
| TRAPPIST-1, 2566 K | **9.1 Gyr** |

That last row is most of why the TRAPPIST-1 planets are in the state they are, and it is checkable:
**TRAPPIST-1 is still X-ray active at the age it actually is.** The system is 7.6 ± 2.2 Gyr old
(Burgasser & Mamajek 2017) — the presets used to say 4.567, which was just the solar system's number
left in place — and at 7.6 Gyr it is still inside its saturated stretch. So the spin-down switch,
armed, correctly does *nothing* to it. `selftest.js` now runs every dwarf preset's measured XUV back
up the curve and fails if it implies a star brighter than stars get.

Above the saturation age the curve is identical to the bare power law it replaced, which is why no
solar preset moves and none of the 23 anchors shift: every one of them starts past it.

### TRAPPIST-1 at one billion years

Two presets for the age the story starts at, sharing everything with their present-day selves that
six and a half billion years does not change — mass, orbit, star, tidal heat — and differing only in
age, water and air. The star does not change over the run, and that is the point: an M8 saturated to
9 Gyr means these worlds spend their **entire lives** under 200× the Sun's ultraviolet, with no let-up
to wait for. The loss is not a phase they come out of, it is the whole biography.

**TRAPPIST-1b · 1 Gyr arrives exactly.** Five Earth oceans and twenty bar of CO₂ are stripped to
nothing over 6.6 Gyr and it ends airless — which is what JWST finds and what Bolmont et al. (2017)
predicted from the XUV history. Eight oceans is a different planet: it never loses the last of them
and stays in a wet runaway, so the inventory sits on the side of that fork matching the world we can
see.

**TRAPPIST-1e · 1 Gyr arrives too**, and what it arrives at is a planet with a sea and hardly any air
above it. Three oceans, a bar of N₂ and two of CO₂ at 1 Gyr. The nitrogen goes to space — 206× solar
held for the star's whole life, and the loss is a *flux*, so **a hundred bar would go the same way as
one** — and once the air is too thin to carry heat across, the CO₂ snows onto the hemisphere that
never sees the star and cannot climb back. Four bar of dry ice lies there at the end.

What does not go is the ocean. The day side sits at 55 °C under 0.07 bar, ninety percent of the
surface is flooded, and **six tenths of an Earth ocean is liquid**.

So the *present-day* preset was rewritten to match, rather than the young one tuned to reach the old
one. The old 1e carried a bar of CO₂ over a bar of N₂ and said of itself that it was a plausible
configuration rather than a measured one — what it did not say is that this model never let it keep
that: press play and it collapsed to 0.08 bar inside a hundred million years, every time. **A preset
whose first act is to abandon its own configuration is a starting gun, not a snapshot.** It starts
where it ends up now: stable across a billion years instead of a hundred million, less Earth-like than
the bar of CO₂ it replaces, and where its own younger self actually lands — 0.62 EO of liquid against
0.61, 90% flooded against 90%.

That rewrite exposed a disagreement inside the model. **Two states were reported uninhabitable while
their own text called them habitable.** A Partial Nightside Freeze-Out is *defined* by still having a
sea — the branch cannot be reached unless liquid water is present, and the instant the last of it goes
the world becomes a complete Nightside Freeze-Out instead — and its blurb says "the day side is still
warm, wet and habitable while it happens". A Twilight World's branch requires a liquid ring around the
terminator and its blurb calls that ring habitable. Neither was on the habitability list. Neither is
Earth-like, and neither needs to be: what that flag answers is whether there is liquid water somewhere
a thing could live in, and on both of these there is, by construction.

**And it used to run only on worlds whose star was also getting brighter.** The XUV decline was nested
inside the `brightening` branch — two lines under a comment saying it matters far more than the
bolometric brightening for anything to do with escape. Every M-dwarf preset carries `brightening: 0`,
correctly, because over any run TRAPPIST-1's luminosity really is flat. So XUV was pinned for the
entire run on TRAPPIST-1b and 1e (206× solar) and GJ 1132 b (59×) — the worlds where XUV is the
dominant process and everything else is scenery.

It is **its own switch** now, `star spins down`, sitting beside the XUV slider rather than folded into
the brightening one. They are separate physics that happen to belong to the same star: the bolometric
track is the core filling with helium, the spin-down is the surface losing angular momentum to its own
wind, and the two run in opposite directions. Having them share a control meant a world could not be
asked what it would do under a star that never calmed down — which is close to what a flare star is,
and a fair thing to want to ask.

`brightening` still gates the luminosity and only the luminosity, and it keeps its double duty as a
speed: a star living three times over spins down three times as fast too.

**The three red dwarfs ship with it armed** — TRAPPIST-1b, TRAPPIST-1e and GJ 1132 b — along with the
Eye of the Red Dwarf scenario, whose own hint already tells you to watch the XUV. So do the solar
histories, which had it before it was separable. The invented worlds — the ocean world, the dune
world, the snowball — start with it off, which is exactly what they did before the switch existed.
Flipping it mid-run re-bases the curve on where the star actually is, so turning it on does not
teleport the ultraviolet to wherever an untouched curve had reached by then.

### Three worlds tuned by where they end, not where they start

The two early Venus paths and Noachian Mars are presets whose endpoints are observations, and all are
pinned by the run rather than by the setting.

The ocean-bearing Early Venus arrives at **738 K under 92.1 bar with no water in it**, against the 737 K, 92 bar and 30 ppm
the planet has. Getting there took two corrections. Its insolation is 1.524 rather than Way's 1.40,
for the same reason the Archean carries 0.77 — a world that starts at an age of 1.67 Gyr and runs to
the present has to *arrive* at the 1.911 S⊕ Venus gets. And the cold trap had to be allowed to fail:
see the escape bullet above. It stays habitable at 26 °C until 3.67 Gyr, boils at 3.80, and is dry by
4.42 — which is Way's timeline, not an imposed one.

**Never-Wet Venus** is the alternative hot-start history rather than a replacement for Way's.
Turbet et al. (2021) found in a 3-D GCM that an initially steamy Venus forms nightside water clouds
with a net warming effect, preventing ocean condensation even under the faint young Sun.
Constantinou, Shorttle & Rimmer (2024) approach the question from modern atmospheric chemistry and
find Venusian volcanic gas at most 6% water, consistent with a mantle desiccated during an
approximately 100 Myr magma-ocean epoch. The preset therefore begins at 0.1 Gyr with 0.06 Earth
oceans entirely as steam, never seeds an ocean, and follows dry secondary outgassing. At 4.567 Gyr
it reaches **737 K and 92.0 bar: 88.5 bar CO₂, 3.51 bar N₂, no residual O₂ or ocean**. This zonal
sandbox represents the constrained history; it does not claim to reproduce Turbet's 3-D clouds.

Noachian Mars arrives at **5.8 mbar and −69 °C** against 6.0 mbar and −63 °C, with outgassing at 0.14
of Earth's. 0.2 left it at 11 mbar, twice as thick as the planet out there.

`node tools/track.mjs earlyVenus` prints either run every 250 Myr.

### The mean is not a temperature a locked world has

TRAPPIST-1b settles at a global mean of **−1.5 °C**, which reads as temperate and describes nowhere
on it. The day side never sets and sits at **237 °C**; the night side never sees the star and sits at
**−186 °C**. So a tidally locked world reports **Day side** and **Night side** instead of Range —
both the four-band averages `classify()` already uses to tell eyeball from lobster from twilight, so
the readout and the label cannot disagree about which side is which.

That planet also reads "534 bar CO₂ frozen out", which sounds like a frozen planet and is not: it is
frozen onto the half that never sees daylight, while the other half is hot enough to melt lead. It
says *frozen onto the night side* now.

The physics behind it is real and named. If the night side falls below a gas's condensation
temperature it becomes a **cold trap**: the gas freezes out, the greenhouse weakens, the planet
cools, and the collapse accelerates itself. Proposed by Kasting 1993 and Joshi 1997, worked out in
detail by Wordsworth 2015 and Koll & Abbot 2016, and the reason atmospheric collapse is a standing
question for every close-in M-dwarf planet.

The model has the **threshold** as well as the behaviour, which is the part worth checking:

| starting CO₂ | after 1 Myr | night side |
|---|---|---|
| 0.1 bar | **collapsed**, nothing left | 85 K |
| 2 bar | 1.78 bar still airborne | 265 K |

Above about a bar, transport keeps the night side warm enough to hold the gas. The published figure
for TRAPPIST-1 planets is collapse below roughly **100 mbar**, so this model is somewhat more eager
to collapse than the GCMs — a one-dimensional scheme moves heat to the night side less effectively
than a real circulation does, which is the same limitation that shows up in the habitable-zone
rotation row above.

**A collapse under way and a collapse that has finished are two different planets**, and they were
sharing a name. The interesting one is the first: a TRAPPIST-1e at 66 Myr with 0.38 bar of CO₂ lying
on its dark side and 134 mbar left in the air, its day side at 122 °C with a liquid sea and a
biosphere on it — a habitable world quietly losing its atmosphere behind it, which is the whole
reason **Partial Nightside Freeze-Out** is worth a state of its own. The end of that same road has no sea at
all: the air is dry ice on the hemisphere that never sees the star, the water is glacier ice beside
it, and the day side is bare. That is a **Nightside Freeze-Out**, and it needed splitting off
because the partial state's blurb *promises* a working ocean — text that was simply false on a world whose
water had all frozen out. The condition is now the promise: liquid water, and enough of it to be a
sea rather than a damp patch (`liquidShare > 0.02` and `flooded > 0.01`). Neither is the
**Nightside-Trapped Desert** above, where the air is intact and only the water has migrated.

### What a hot surface looks like, and what it does not

The night side used to be painted with a glow taken from the planet's **mean** temperature. A mean
is not a temperature any ground has: GJ 1132 b runs a 1271 K day side against a 693 K night side for
a 920 K mean, and that mean washed the dark half in orange **four times brighter than the terrain
underneath it**, carrying no surface detail because it varied only with the smooth day-to-night
ramp. It read as a blur, which is how it was reported.

The brightness comes from the **local** band temperature now, and the curve is steep because the
physics is. The *visible* share of a blackbody is a Wien tail — integrate Planck over 400–700 nm:

| | 692 K | 798 K | 1000 K | 1300 K | 1500 K |
|---|---|---|---|---|---|
| visible fraction | 5.7×10⁻¹⁰ | 1.9×10⁻⁸ | 1.9×10⁻⁶ | 1.0×10⁻⁴ | 5.6×10⁻⁴ |

**Ten orders of magnitude** across a range the old linear ramp treated as gently rising. 798 K is the
**Draper point**, where solids first glow dull red. `exp(11.68 − 17520/T)` is that tail's own shape
and fits the integral to within 13% from 900 K to 1500 K; the self-test checks it against the
integral rather than against the constants, so the fit cannot drift from the physics unnoticed.

Venus is the check that costs nothing. Its surface is 737 K and does **not** glow visibly — which is
why photographs of it are lit by daylight through the cloud rather than by the ground. Under the old
formula it did.

Measured on the software renderer, GJ 1132 b's night side went from **14.4% to 22.7% detail
contrast**: the wash is gone and the terrain is visible through it. Genuinely molten ground still
glows — the lava crust was never part of this bug, because it always read the local temperature and
always had its own cracked-crust detail.

The GLSL cannot import the JS, so the curve is written twice and `tools/glslcheck.mjs` pins the two
to the same constants. A machine on the software fallback must not see a different planet from one
with WebGL.

### Frost is only as strong as the world is wet

Same class of mistake, found by someone asking why Mars did not look like Mars. It has its real
photograph and its real topography, both loaded, and it still drew as a pale featureless ball —
because the shader painted frost over 98% of the disc and buried the map underneath it:

```glsl
frostMask = clamp(ice, 0.0, 1.0) * land * (1.0 - sheetMask);
col = mix(col, mix(col, vec3(0.66, 0.66, 0.68), 0.55), frostMask);
```

`ice` is a pure function of temperature, and Mars's *warmest* band is 223.5 K — twenty-nine kelvin
past the end of that ramp — so it is 1.000 in all eighteen, while `uGlaciated` is 0.000 and the
sheet term that was supposed to suppress it does nothing. Measured on the real `mars.jpg`, that wash
cost **55% of its contrast and 57% of its chroma**: mean rgb (0.717, 0.386, 0.280) became
(0.686, 0.537, 0.500). Noachian Mars sits at 280 K, so its `ice` is 0.02 and the same file shows in
full — same map, same loader, opposite outcome.

**The physics had the missing term all along.** `radiation.js` computes the frosted albedo as
`landAlbedo + (ALB_FROST − landAlbedo) · waterCap`, commented *a bone-dry frozen world stays the
colour of its dust*, and names Mars. The three renderers were that same statement with the last
factor dropped, so the picture and the model were describing planets **14.5 K apart** — a globally
frosted Mars runs at 197.6 K against the 212.2 K the model computes and the 210 K the planet has.
`waterCap` multiplies the *strength* rather than the area, because that is where the physics puts it.

Mars's `waterCap` is 0.052, so this changes Mars nineteenfold and **no other preset by more than
0.007** — every water-bearing world sits at 0.97 or above and the term is a no-op there. It was not
adding the polar caps it appeared to be adding, either: the map already carries them at the right
latitude and area, and the wash was flattening them from both ends.

The readouts overstated it in exactly the same way, and the honest number was being computed one
line below the one being shown. **`iceMean` is how much of the surface is below freezing; `iceArea`
is how much is under ice.** On Mars those are 100% and 1.9% — and 1.9% is about the perennial caps
the planet really has. Both the "Ice cover" stat and the state subtitle print `iceArea` now.

What was missing was not a test that the map loads; everything already asked that and all of it
passed. `bodycheck.mjs` could not have caught it for a sharper reason than "it only tests warm
worlds": both worlds it builds have band ice identically 0.000, so the frost path has never run in
any frame that tool has rendered, and its metric counts pixels that *changed* when the map was
switched on — which reads 18% whether the map is at full strength or at 45%. The missing measurement
was amplitude. The smoke test now asks the physics and the picture how far each takes the ground
toward frost and requires the same answer, reading the shader source for the renderer's half so it
measures the renderer rather than restating it. It needs no GL, which matters, because `bodycheck`
skips silently wherever headless GL is not installed and that is how this shipped.

### Where the surface comes from

There are no photographs of the invented worlds, and none of TRAPPIST-1b, TRAPPIST-1e or GJ 1132 b —
nobody has imaged their surfaces. What you are looking at is **procedural**: gradient noise with
domain warping for the continents, so coastlines have bays and peninsulas rather than round islands;
ridged multifractal mountain belts in the continental interiors; slope-based relief shading from a
sampled height field; and biomes that answer to both altitude and climate.

That shape is then coloured by six **material** albedo maps — rock, desert, vegetation, ice, ocean,
lava — which were generated with an image model and downscaled to 1024×512 JPEG (24 MB of PNG became
832 KB with no visible loss). They are tiled material detail, not maps of anywhere. A world with no
albedo maps available stays fully procedural and says so, and on a device with only eight texture
units the albedo path is compiled out entirely.

Only **Earth, the Moon, Mars, Venus and Titan** carry real photography, and only Earth and Mars carry
real topography. Shared sources and licences are in `../assets/bodies/CREDITS.md`; this build's own
lunar source is in `assets/bodies/CREDITS.md`.

Relief follows the same rule. Earth and Mars keep slope lighting from their matching DEMs; a
colour-only map such as the Moon's does not inherit ridges from the random procedural planet beneath
it. The generated relief fades out as that photograph fades in, leaving the real maria and craters
legible instead of embossing them with invented terrain.

Vegetation is not permanently green. The renderer interpolates representative one-atmosphere colours
from Luke Campbell's *Colors of Alien Plants*: A-star brown, F-star blue-violet, solar G2 green,
K-star orange, and M-star violet/blue grading to pale tan at late M. It recolours procedural biomes,
the generated vegetation material and vegetation pixels in real Earth photography alike, while
preserving each texture's brightness and detail. At exactly 5772 K the transform is identity, so
Earth under the real Sun remains natural; move Earth's star-temperature control and its plants change
with every other planet's.

### Looking at it

Drag to orbit the camera — the star, the terminator and the ice caps stay where they belong and you
simply look from somewhere else. The **0.5× / 1× / 2×** selector chooses drag sensitivity directly
and remembers it; 1× is the default. Its options need an opaque background of their own: the rail's
button colour is deliberately translucent so a control sitting over the planet does not block it, and
the browser paints the open menu from that same colour — which made the list unreadable against the
globe showing through it. **Scroll out to zoom out, scroll in to zoom in**, or pinch; double-click resets. Zoom moves the
camera rather than narrowing the lens, so the planet keeps its perspective and the atmosphere's limb
still reads correctly; drag sensitivity also scales with camera distance.

### Volcanism you can see

Strong volcanism used to be invisible. A world at twenty times Earth's outgassing rendered
*identically* to one at zero: `outgassing` reached the carbon cycle, the oxygen budget and the
methane, and never reached a shader at all. Two things now carry it.

**Vents, on the night side.** This is what a volcanic world actually looks like from orbit — not a
red planet, but points of light on the dark half, which is how Io's eruptions are seen. They sit on
the terrain's own fine channel rather than on new noise, so a vent stays in the same place and turns
with the planet; more of them appear because the threshold through that fixed field walks down as
activity rises, not because anything is re-rolled. Land only, since a vent under three kilometres of
water is a black smoker, and the lit half gets dark unweathered flows around the same points instead
of a glow.

**Ash and sulphate, by day.** A heavily volcanic world is not only bright spots at night: it is hazy,
because sulphur dioxide oxidises to an aerosol that stays up for years. Pinatubo put 20 Tg of it into
the stratosphere and cooled the planet half a kelvin; a world erupting continuously never clears it.
Yellow-grey and slightly brightening, which is what separates it from the organic haze — that one is
orange and dims. It needs air to hang in, so it fades out with surface pressure: **Io has no ash haze
because Io has no atmosphere**, and neither does this.

What both read is melt production, `outgassing × √(F_int/F_⊕)` — the same `meltBoost` the carbon
source uses, and *not* the mass factor that goes with it there. `outgassingScale` is about how much
volatile a bigger planet delivers per square metre; it is not about how much lava is on the ground,
and including it read Io as a quarter of Earth's volcanism, which is exactly backwards for the most
volcanically active body known. It is melt production and not the CO₂ that rides up with it, for the
same kind of reason: a mantle whose carbon is exhausted still erupts, it erupts volatile-poor lava,
and a world going quiet on screen while its interior is still molten would be telling a lie the model
does not believe.

| world | vents | ash |
|---|---|---|
| Mars | 0.03 | 0.00 |
| Earth | 0.20 | 0.00 |
| Earth at 20× outgassing | 0.89 | 0.32 |
| Io-like, 2 W/m² tidal | 0.51 | 0.00 — no air |
| GJ 1132 b, 80 W/m² | 1.00 | 0.16 |

It cost no uniform. The fragment stage is at its guaranteed budget of 32 vectors, and a slot holds
four components whichever way you fill it — so `uYaw` and `uPitch`, two scalars burning two slots,
became one `vec2 uCam` and paid for `vec2 uVolcano` outright. `glslcheck.mjs` fails if they are ever
split back apart, because the failure mode is a shader that will not link on hardware that only
guarantees the minimum: someone else's machine, never this one.

**Clouds can be switched off.** Two thirds of Earth is under cloud at any moment and the deck is drawn
faithfully, which is a problem when what you want to look at is which continents are actually flooded,
where the ice really reaches, or what a mapped body's surface looks like without its own weather on
top of it. The ☁ button hides them. It is a *view*: the deck still reflects its sunlight and still
cools the planet, the readout's cloud cover does not move, and neither does the temperature — checked
in the browser to twelve decimal places, because a control that quietly changed the climate while
claiming to change the picture would be worse than not having one.

It needed no new uniform, which matters because the fragment stage is at its budget of 32. The shader
already ends the cloud deck with `clamp(uCloud + uLocked*sub*0.35, 0.0, 1.0)`, so handing it a negative
cover clamps to nothing on its own — including a tidally locked world's substellar pile-up, which is
added inside the same clamp. `glslcheck.mjs` fails if that clamp or that 0.35 ever changes out from
under it.

The main **Pause** control freezes the globe's automatic visual rotation as well as simulated time.
Play continues it from the same longitude, unless the separate rotation button was already paused;
that manual choice is preserved.

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

### An interior is not a constant, and tidal heat is not radiogenic heat

**Every real world and every scenario now runs with the interior ageing** — `realisticGeology` on by
default, for Earth, both Moons, Venus, Mars, Titan, the Archean, both early Venuses, Noachian Mars, Earth +1 Gyr, all
three exoplanets and all eight scenarios. Radiogenic heat falls with the potassium, thorium and
uranium that make it — Earth's interior ran at three times today's flux when it was half a billion
years old — and because outgassing goes as `√(F/F_earth)`, the volcanoes come down with it without
being told to. Holding that still across a billion-year puzzle would be the one place this model
lied about time, which is its whole subject.

The reason the three M-dwarf worlds used to have the switch **off** is that theirs is a different
kind of heat. TRAPPIST-1b's 2.68 W/m² and GJ 1132 b's 80 come from an eccentricity held by a
resonance with a neighbouring planet: it is set by the orbit, not by how much potassium-40 is left,
and it is the same now as it was three billion years ago. Running those worlds down a half-life
curve would have cooled planets that are not cooling.

So the decay now applies to the **radiogenic part only**. A preset can declare `tidalHeat`, the share
of its interior flux that comes from being kneaded, and that share is held while the rest runs down;
anything the player adds on top of the published tidal flux is treated as radiogenic and decays. That
is what lets the switch be on everywhere and still be right, and it gives those three worlds the
dynamo decline they were also missing. Measured over 3 Gyr with the switch on for both: GJ 1132 b
holds 80.0 W/m², Earth falls from 92 to 59 mW/m².

What it costs the scenarios is small and in the honest direction — the interior fades over the run,
so the volcanoes do too:

| | Break the Snowball | Hold Back the Runaway | Terraform | Eye of the Red Dwarf | Undo Venus |
|---|---|---|---|---|---|
| span | 200 Myr | 1 Gyr | 500 Myr | 1 Gyr | 1 Gyr |
| interior at the end | ×0.96 | **×0.76** | ×0.91 | ×0.84 | ×0.84 |
| volcanism at the end | ×0.98 | ×0.87 | ×0.96 | ×0.92 | ×0.92 |

"Hold Back the Runaway" moves most, because it is the one that starts young — 2.75 Gyr — and it moves
in the player's favour: the 2.5× volcanism that keeps putting the CO₂ back is 13% weaker by the end.

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
the slider round trip, and that the Moon, Venus, Mars and GJ 1132 b agree with their world presets — so
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

### Standing in a world's own past

The temperature chart is a control as well as a picture. **Drag along it** and the
simulation goes back into a state it was actually in — the sliders move back to
what they were, the ice returns, the carbon goes back underground. Change one
thing from there and the world takes a different route.

That is the question this model is really for: not *what happened*, but **what
would it have taken for this not to happen**. Run a world into a runaway, drag
back to before the ocean went, drop the insolation a tenth, and watch it not
happen.

Whole world states are kept as it runs — about 1.1 kB each, 160 of them, so
roughly 180 kB against the megabytes of surface texture already resident. They
are captured on the sampler the clock already runs, so every moment you can go
back to is a moment the chart actually draws.

**A world has one history, not a tree of them.** Going back and changing
something drops the path you are leaving. If you want to keep it, save it to a
slot first — and since slot 1 has been keeping itself, in practice the version
you walked away from is usually still there.

#### The property that has to hold

Going back must be **exact**. A world restored to a moment and run on has to
arrive precisely where it would have arrived without the detour — not nearly,
exactly, because the stepper is deterministic and any drift at all means the
snapshot is missing something. The self-test runs 700 kyr both ways and compares
eight state variables:

```
straight through : 279.20489  0.0012817195  0.18303652  0.79893916  4068551.6 …
via a rewind     : 279.20489  0.0012817195  0.18303652  0.79893916  4068551.6 …
```

Verified to bite: deleting `carbonDeep` from the snapshot moves the mantle by
50 kg/m² over that span and the check fails. That guard covers the save slots
too — they share one definition of what a world is, in `src/game/snapshot.js`,
precisely so this test means something for both.

#### Thinning, and two versions of it that were wrong

The buffer fills, and half the moments have to go. What matters is the **widest
gap as a share of the chart**, because that is what a drag crosses.

| | widest gap |
|---|---|
| keep every second point | **63% of the chart** |
| re-space evenly by array index | **63% of the chart** |
| re-space evenly by log time | **3.1%** |

Both simple versions fail the same way: they thin an array whose spacing is
already uneven and preserve that unevenness, so the old end doubles its gap
every round while the new end stays dense. After sixteen hundred points the
worst gap was 1008 against a best of 1 — two thirds of the run with nothing to
land on, and dragging there snapped back to one ancient moment. Selecting
against log time re-derives the spacing from the times themselves every round,
so it cannot drift.

The first version of that test used evenly spaced integers and passed all three.
The simulation samples **geometrically** — the next sample is 2% of elapsed time
away — and it is the interaction between geometric spacing and repeated halving
that opens the gaps. The test feeds it real runs of 1 Myr to 10 Gyr now.

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

#### Autosave, and the guard that makes it safe

**Slot 1 keeps itself**, every 30 seconds and again when the page is hidden or
closed — `visibilitychange` and `pagehide`, because iOS Safari does not fire
`beforeunload` at all when an app is swiped away.

The rule that makes it safe rather than a hazard is that **it will not write
until the session has been touched**. A fresh page starts with the clock
*running*, so "the world has changed" is true within a frame of opening the tab.
On that alone, opening the page and walking away for half a minute would put a
default Earth over the world you left there yesterday — which is the one way an
autosave stops being a convenience and becomes a way of losing things.

So there are two flags. The clock moving makes the world **dirty**; only a
deliberate act — a slider, a preset, a scenario, a reset, a settle, pressing
play — makes the session **touched**; and nothing is written until both are
true. Open it, look at it, close it, and your autosave is still yesterday's.
Loading a slot also clears the flag, so opening slot 3 does not copy itself into
slot 1 a moment later. `tools/smoketest.mjs` pins all of that.

#### Every save in one file

**Export all…** writes the whole set as JSON; **Import…** reads one back. A
snapshot is about 1.5 kB, so a full set is a few kilobytes.

Import is a **merge, not a replacement**, and that is the rule worth stating: a
file with three planets in slots 1–3 leaves slots 4 and 5 exactly where they
were, so importing somebody else's set cannot quietly take yours with it. A
world that names a slot gets that slot; one that does not gets the first free
slot; and when there is nowhere left it says so rather than overwriting.

It is liberal in what it reads — the file this writes, a bare array of worlds,
or a single world on its own — because people hand-edit these. It is strict
about one thing: a world has to carry `params`, or it is some other JSON that
happened to be lying around, and filling the slots with it would throw on
restore.

None of this replaces the address bar. **A single world still travels in the
URL** and always will; that needs no file and no download, and it is how two of
this model's bugs were reported. The file is for the other case — a whole set at
once, or keeping saves somewhere that is not this browser's localStorage, which
is where saves go to die the moment a browser clears site data.

The rules live in `src/game/saves.js`, free of the DOM and of storage for the
same reason `controls.js` is: which slot a world lands in is a decision worth
testing on its own, and it needs no browser to make.

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

#### Out of how much, though

Habitable *area* is the right measure. What it is a fraction **of** was not.

A tidally locked world has half a globe the star can never reach — and that half
was dark in the physics **and** counted in the denominator, as ground life had
failed to use. So a locked world with a perfectly temperate, wet, continuously
sunlit day side could never read above half of Earth however good it was, and a
good one read a third.

The two were never comparable as written. `insolationProfile()` hands a rotating
world its **diurnal mean** — every band is lit, and the fact that each is dark
half the time is already averaged in. A locked world gets the instantaneous
value, so half its bands sit at exactly zero for ever. Integrate properly and
they come out level: half the area lit always, against all of it lit half the
time, the same πR²F either way. And photosynthesis is light-saturated far below
full sunlight, so what limits production is habitable area, not flux.

So the denominator is now the part of the planet the star ever reaches.

| | before | now |
|---|---|---|
| Earth, Waterworld, Dune World | 1.000 | **1.000** |
| Locked Eyeball | 0.333 | **0.675** |
| TRAPPIST-1e | 0.414 | **0.831** |

Every rotating world is untouched to the last digit — the dimmest band on Earth
still gets 204 W/m², and even 90° obliquity leaves 17, against a threshold of
half a watt — so the denominator is exactly 1 and the arithmetic is unchanged.
It moves nothing anywhere except where a permanent night side exists, which is
the only place it was wrong.

The night side is still worth nothing, and that is now tested directly rather
than inferred from a number: warm every one of the Locked Eyeball's nine dark
bands to a perfect 20 °C and photosynthesis does not move, because there is
still no light there.

**Carbon starvation is a separate death and still bites.** Switch volcanism off
and weathering draws CO₂ down to nothing; nothing photosynthesises without
carbon, however warm and wet the day side is. That is the usual reason a locked
world with visible oceans reads dead — not the temperature.

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

### Methane is made of carbon, and life needs light to make it

Two reservoir bugs, found together because they produced the same symptom: a
number that grew and never stopped.

**A world under its own haze went on making methane for ever.** The biological
source scaled with the biosphere slider, a wetness gate and a thermal one — but
never with *light*. That is not a corner case, because the gas makes the smog
that does the blocking: at 0.274 S⊕ with an Io-like interior a world closed its
haze deck over, kept producing at the full Earth rate in the dark, and reached
**744 bar of methane** and climbing.

The source is now proportional to the light that actually reaches the ground —
through `swTrans`, not top-of-atmosphere. Methanogens do not photosynthesise,
but nearly all of them eat something that did. The saturation point is a seventh
of Earth's mean, so Earth and the Archean are both light-saturated and neither
moves; it only bites in the dark. The loop it closes is **negative** (more
methane → more haze → less light → less methane), unlike the temperature loop an
earlier attempt at this hit, which ran the other way and oscillated.

That world now settles at **6.2 bar** instead of 744.

**And methane was made of nothing at all.** Both source terms ran against no
reservoir, which is invisible while methane is a trace gas and absurd when it is
not: that same world carried 744 bar of CH₄ — 2000 bar of carbon — while its
mantle still held 400 bar of its own. It comes out of the two pools the CO₂
cycle already uses now, capped by what is there, and destruction hands it back.

> Closing the loop is the conservative choice and it costs something real. In an
> anoxic atmosphere methane photolysis buries its carbon as tholin — Catling's
> irreversible oxidation of the early Earth — and that share was routed to the
> interior first. It cannot work without an organic-carbon reservoir the model
> does not have: burial is one-way, so at steady state it is a **pump** running
> surface-to-mantle at the full production rate for ever, and once the surface
> pool empties the debit clamps at zero while the credit does not.

### The mantle was being refilled from nowhere

Same class of bug, and it is why volcanism looked like it had a bottomless tank.

The carbon cycle's exchange with the interior is damped semi-implicitly, so that
a long step lands on the right answer instead of overshooting past zero. The
damping was applied to the atmosphere and **not** to the mantle: over a step the
surface gave up `(Wr−V)·dt·damping` while the interior received the whole
`(Wr−V)·dt`. The difference is carbon that never existed.

| after 20 Gyr | before | now | budget |
|---|---|---|---|
| Earth, 1× volcanism | 414 bar | **400** | 399 |
| Earth, 5× volcanism | **951 bar** | **402** | 399 |
| dry, 5× volcanism | 400 bar | 400 | 399 |

A dry world was always exact, which is why this survived so long: with no liquid
there is no weathering and the term is zero. The leak needed a **working carbon
cycle to hide in**, and it scaled with the flux through it.

So: does the mantle run out? **On a dry world, completely** — 374 bar → 0, with
the whole 399-bar budget in the air, and then it stops. On a wet world it does
not, and should not: weathering buries carbonate and subduction returns it, so
the two settle into exchange. That is a cycle reaching equilibrium, not a tank
draining. What was wrong was that the equilibrium sat at 951 bar of carbon on a
planet given 399.

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

### How deep the water goes, and what it turns into

On a rocky world this is a dull question. Earth's ocean is 3.7 km deep averaged over the globe, its
density is 1000 kg/m³ top to bottom, and treating it as an incompressible film loses nothing. The
readout said `water × 2750 m` and was right.

On a water-rich sub-Neptune the same arithmetic returns a number that is not imprecise but
meaningless. K2-18 b's water, spread over its surface at constant density, is **fifteen thousand
kilometres deep** — most of the way to the planet's centre. (The old readout said 95,000 km, because
2750 m per ocean is *Earth's* figure and a bigger world spreads the same water over more area under
more gravity; it was out by a factor of six before the physics even got a say.)

Water does not do that. Long before then the pressure passes a gigapascal and it freezes — not
because it is cold but because it is squeezed. **Ice VI and ice VII are stable well above room
temperature**, ice VII up to several hundred kelvin, and they are what a deep ocean actually stands
on. So a Hycean ocean has a floor, and the floor is ice.

`src/physics/ocean.js` finds it, from three measured things: water's compressibility (Tait, K₀ = 2.2
GPa), the ice VI and ice VII melting curves anchored on the **VI/VII triple point at 2.216 GPa and
355 K**, and the ocean's own adiabat. It is a **diagnostic** — there is no vertical ocean grid and
nothing integrates it; the readout and the classifier read it and that is all.

Three attempts at the adiabat are worth recording, because each looked reasonable:

* **Marching down in pressure, stepping by a fraction of the melting pressure.** A positive feedback:
  a hotter step raises the melting pressure, which lengthens the next step, which heats it further.
  Ocean floors at 30,000 K.
* **Solving the exponential form** T = T₀·exp(k·Δp), which is exact only while k is constant. It is
  not — k = α/(ρc_p), and water's thermal expansivity collapses under compression. Across hundreds of
  GPa this gave floors at 10⁸ K.
* **Checking whether the adiabat is below the melting curve at the bottom of the column.** The two
  curves generally cross **twice**: the adiabat dips below the melting curve around a couple of GPa
  and comes back above it ten or twenty GPa further down. The ice is a *band*, with fluid on both
  sides — which is the structure the Hycean interior literature describes. Testing only the bottom
  found the adiabat back above and concluded nothing ever freezes.

What works is letting α fall as 1/(1 + p/K₀) — the simplest form that weakens on the same pressure
scale as the compression — which integrates to a logarithm, and then scanning for the *first*
crossing rather than assuming there is one.

The result reproduces the published phase structure. On a 5 M⊕ world:

| surface T | liquid | floor | model |
|---|---|---|---|
| 280 K | 80 km | ice VI | 273–295 K → ice VI (Nixon & Madhusudhan) |
| 300 K | 117 km | ice VI | boundary lands at ~310 K here, 295 K published |
| 350 K | 214 km | ice VII | 295–413 K → ice VII |
| 500 K | 939 km | ice VII, supercritical above it | 413–647 K → supercritical layer between |
| 647 K | 2764 km | ice VII | at the critical point |

The physics that makes that table interesting is in the second column: **a hotter ocean is a deeper
ocean.** The ice VII melting curve rises steeply with temperature, so warming the surface does not
boil the sea away, it pushes the ice floor down — 80 km of liquid at 280 K, 2764 km at 647 K. The
selftest asserts that monotonicity across the whole 350–550 K band this build exists for.

Solving it costs about as much as a radiative step, and nothing in the physics reads it, so it is
attached to the diagnostics **lazily**: the readout looks once a frame where `update()` runs hundreds
of times. Computed eagerly it cost 190 µs a step for a number nobody had asked for.

### A planet the size the planet actually is

Every world this model could build had a rocky radius, `R = R⊕·M^0.27`, and for rocky worlds that is
fine — Earth 1.000, Venus 0.946, Mars 0.547 against measured 1.000, 0.950 and 0.532. For a
sub-Neptune it is not a small error. K2-18 b is 8.63 M⊕ and **2.61 R⊕ measured**; that relation says
**1.79**. All four reference sub-Neptunes came out about 40% too small, and by a strikingly *uniform*
amount across 4.78–10 M⊕ — which says the missing physics is bulk composition, not a wrong exponent.

Zeng et al. (2019) give it as **R = f(x)·M^(1/3.7)** with **f = 1 + 0.55x − 0.14x²**, x the water mass
fraction. Two things about that are lucky and one is not.

The lucky ones: **1/3.7 = 0.2703**, so this model's rocky exponent already *is* Zeng's dry branch and
water enters as a clean multiplier rather than a replacement. And **f(0) = 1 exactly** — the constant
term is one, so a dry world is multiplied by 1.0 and comes out bit-for-bit unchanged. That is what
let a mass–radius relation be swapped into a model of twenty-six terrestrial worlds without moving
any of them. (f(0.5) = 1.240 also reproduces the 1.24 the paper quotes for a 1:1 silicate-to-ice
planet — the cheapest available check that it was transcribed right.)

#### Where "ocean" stops and "part of the planet" starts

Not a matter of taste. `hypsometry.js` already says how much water a solid surface can hold before
there is no basin left to hold it — `MAX_BASIN_DEPTH`, a deliberately generous peak-to-trough relief.
Water past that has nowhere on the surface to be, so it is interior water. On Earth that threshold is
**7.3 oceans**, and every world this model ships with carries at most six. The interior water term is
therefore exactly zero on all of them, by construction rather than by tolerance.

#### Two radii, because they are two different things

`derive().R` is the **condensed** radius — rock plus structural water. It is what gravity is computed
at and what a column of gas is spread over. The envelope is deliberately *not* in it: tens of bar of
hydrogen over a super-Earth is a rounding error on the planet's mass, so folding it in would weaken a
gravity the gas does not weaken — and would do it to every world with an atmosphere, Earth included.

`transitRadius()` is what a telescope measures, and it is the one the published radii are compared
against. It sits **ln(p_surf/p_ref)** scale heights above the surface, taking p_ref near ten
millibars: ten bar of envelope puts it seven scale heights up, a thousand bar eleven and a half. A
fixed count of scale heights — which is what the renderer uses to decide where to stop drawing —
would make those two envelopes the same size, which is the opposite of what distinguishes these
planets. The readout shows the second radius only when it differs from the first.

With both terms the four anchors land on their measurements: K2-18 b **2.611** against 2.61 ± 0.09,
TOI-270 d **2.134** against 2.133 ± 0.058, and the Madhusudhan reference planets at 2.151 and 2.600
against 2.15 and 2.60.

#### What that costs, stated as a gap

The compositions it needs are **wetter than the literature builds them** — K2-18 b at a 0.94 water
mass fraction where Madhusudhan's own Hycean models put it nearer 0.1–0.5. The reason is structural:
here the envelope has extent and *no mass at all*. A real sub-Neptune gets a large part of its radius
from an envelope that is several percent of the planet, standing on its own self-gravity and
compressing the interior beneath it. None of that is modelled, so the water fraction has to absorb
the structural work the envelope really does. **The radius is right for the wrong reasons**, and
`calibrate.mjs` reports it as a `GAP` row saying so.

### Hydrogen, which warms by colliding

Every other greenhouse gas here works by having absorption bands, and every one of them eventually
runs out of road: CO₂'s 15 µm core saturates and its forcing goes logarithmic, methane's narrow
bands saturate earlier still and then its own shortwave absorption puts a ceiling on it. **Hydrogen
has no bands at all.** H₂ is symmetric, has no permanent dipole, and on its own ought to be
transparent — except that during a collision the pair briefly *does* have one, and the resulting
continuum has no line structure and so nothing to saturate.

That single fact is why this branch exists. Being a two-body process the absorption goes as the
product of two densities, and integrating that down a hydrostatic column gives

> τ ∝ p<sub>H₂</sub> · p<sub>tot</sub> / g

— **quadratic in surface pressure**, and still climbing where CO₂ stopped paying. Forty bar of it
holds a surface at 280 K **ten astronomical units** from a Sun-like star, where the sunlight is a
hundredth of Earth's (Pierrehumbert & Gaidos 2011). The same world without it freezes solid.

The `1/g` is not decoration. Every other opacity term in `radiation.js` is written in pressures
alone, with gravity folded into a constant that was fitted at Earth's — fine for a term anchored on
Earth, and wrong by a factor of two for one anchored on a super-Earth of three to ten Earth masses.
So this term carries gravity explicitly. It is also added *after* the pressure-broadening factor
rather than inside it, unlike the methane continuum: that one is inside because it was fitted there,
to Titan, and moving it would move Titan; this one is quadratic because the physics says quadratic,
and multiplying it by p^0.3 as well would make it p^2.3 for no reason anyone could defend.

**Helium** rides along as a correction, not a mechanism. It collides about ten times less
effectively than hydrogen does, so a solar-composition envelope is slightly less opaque than the
same pressure of pure H₂. One control sets the envelope; `heliumFrac` splits it, solar by default.

#### Why a hydrogen world has to be a big one

Scale height goes as 1/µ, so hydrogen's is **nine times steam's** and fourteen times air's at the
same temperature and gravity. The envelope stands far taller, presents a much larger cross-section
to the star's XUV, and hydrodynamic loss goes as the *cube* of that radius. A small planet simply
cannot keep one, which is why every world in the Hycean argument is several Earth masses.

Two consequences follow, and the second is the interesting one. Bulk H₂ is not subject to the
diffusion limit that governs the trace hydrogen made by photolysing water — there is no heavier
background to diffuse through, because it *is* the background. And the energy-limited flux is **one
budget, not one per species**: everything leaving is lifted by the same absorbed XUV, so a thick
envelope does not add its loss on top of the ocean's, it *takes* the budget and the ocean beneath is
shielded. Part of why a Hycean world can stay wet where a bare rock would be stripped.

That shared budget runs **both ways**, and the reverse is easy to misread. Put ten bar of hydrogen on
a one-Earth-mass planet at 0.3 S⊕ and the low gravity makes the greenhouse enormous — τ goes as
1/g — so the world runs away to **1400 K**. Its air is then steam: the envelope's share of the column
falls under a percent, its loss is throttled in proportion, and the planet *keeps* its hydrogen
because it is drowning in water. So "fraction of the envelope left after 100 Myr" reads
**non-monotonic in mass** — 31%, 85%, 25%, 52% at 1, 3, 8 and 20 M⊕ — not because escape is wrong but
because those four worlds are no longer in comparable climates. The escape *rate* from identical
starting states is cleanly monotonic and spans a factor of **920** from 0.3 to 20 M⊕, and that is
what the selftest asserts. An earlier version of that check asked only whether one retained fraction
was smaller than another, and passed on the noise.

#### What this is fitted to, and it is one number

`CIA_H2` is fitted to the Pierrehumbert & Gaidos anchor and to nothing else. Every other opacity
constant in this model was fitted against two or three independent observations, several of them
against a planet somebody has measured; this one is fitted against **one number from one 1-D model
of a planet nobody has ever seen.** It is the least constrained number in the model and it should
say so. `tools/calibrate.mjs` carries the anchor so that a change upstream of it — the albedo, the
water partition, the step controller — cannot quietly stop it meaning what this section says.

## Known deviations from the literature

Stated plainly, because a model that hides these is less useful:

* **The Hycean habitable zone's inner edge is far too close to the star.** Innes, Tsai &
  Pierrehumbert (2023) put it at 1.6 AU for a 1 bar H₂/He envelope around a G star and 3.85 AU for
  10 bar — 0.391 and 0.067 S⊕. This model puts them at **1.04 and 0.229 S⊕**: 2.7× and 3.4× too
  close in. Both report as `GAP` rows every run.

  The gap **widens with pressure**, which is the fingerprint of a mechanism that strengthens with the
  hydrogen column, and Innes names it: in an H₂ background, condensing something as heavy as water
  suppresses convection above a critical abundance and leaves a stably-stratified superadiabatic
  layer, so the surface runs far hotter than a moist adiabat allows and the runaway threshold drops.
  At 300 K in H₂ the criterion bites at about a **0.8% water mole fraction**, so essentially any
  humid hydrogen atmosphere is inhibited.

  This model is semi-grey with a single optical depth and no vertical structure. It has nowhere to
  put such a layer and does not pretend otherwise.

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
  aquaplanet still comes out with a 163 K day-night contrast against a land planet's 201 K — a real
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

* **Titan's real map is buried under drawn frost**, 66% of its disc, the same overpaint Mars had —
  and `waterCap` cannot rescue this one, because Titan carries half an Earth ocean of water and sits
  at 1.000. The physics agrees its ground is frost-albedo, so suppressing the frost there would make
  the picture disagree with the model rather than agree with it. What it wants is a decision about
  what this model thinks Titan's surface *is* — water ice under organics is not the bright water
  frost the albedo term assumes — and that is a physics question, not a shader tweak.
* **Ice sheets largely collapse when a world freezes over.** `iceSheetTarget` is gated on
  `smoothstep(0, 0.05, openOcean + vapourShare)`, so a planet with no open water has nothing to
  evaporate and grows no sheet: measured, one peaking at 0.252 falls to **0.033** as the ocean
  closes. It is defensible — a hard snowball is a desert, which is the Dry Valleys argument made
  two sections above — but it also means the coldest worlds get the least white and the most bare
  grey, and it feeds `ALB_SNOW` in the albedo, so changing it would move the snowball anchors. It is
  recorded rather than adjusted for that reason.

Three deviations recorded in earlier versions have since been **fixed** rather than excused: the
runaway inner edge now falls at 1.3–1.4 S⊕ (literature 1.2–1.4), and a dune world stays habitable
about 0.35 S⊕ further in than an ocean world, which is the Abe et al. (2011) result. Both were
symptoms of an integrator bug — the implicit step damped the global mean with the diffusion
coefficient, which only moves heat between latitudes and cannot slow uniform warming — that made
the whole planet heat thousands of times too slowly. It is now solved as the tridiagonal system it
actually is.

The third is **the carbon cliff at 2.7× outgassing**, which used to head this list: an Earth-like
world that sat at 3400 ppm for fourteen million years and then staggered into a 521 °C steam
greenhouse by way of a 1147 °C overshoot. It was diagnosed here as a thermostat problem needing the
atmospheric window this scheme does not have, and reported on that basis. **That diagnosis was
wrong**, and the giveaway was in the trace the whole time: CO₂ was *falling* while the temperature
exploded. It was methane — three times Earth's volcanism outruns an Earth-like biosphere's oxygen,
the air goes anoxic, methane's sink goes with it, and methane had no ceiling because it was
longwave-only. Give it the shortwave absorption it really has and the ladder is habitable end to
end (15, 19, 20, 13, 16, 20, 26 °C from 1× to 8×). What is left at the same place is a real
transition and a modest one: the air still goes anoxic between 2.6× and 2.8×, and the world gets
about **seven kelvin colder**, which is the direction Byrne & Goldblatt and Eager-Nash give. See
*What it was breaking*, above.

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
al. 2023 (TRAPPIST-1b's 503 K dayside, and no atmosphere) · Joshi, Haberle & Reynolds 1997,
Wordsworth 2015, Koll & Abbot 2016 (night-side cold traps and atmospheric collapse on tidally locked
planets) · Turbet et al. 2021 (nightside-cloud warming and inhibited early Venus oceans) ·
Constantinou, Shorttle & Rimmer 2024 (dry Venusian interior from volcanic-gas chemistry) · Needham &
Kring 2017 (transient ancient lunar atmosphere and water inventory) · Draper 1847 (the temperature
at which solids begin to glow visibly).

## Licence

**GNU General Public License, version 3 or later** (GPL-3.0-or-later). The full text is in
[`LICENSE`](../LICENSE); `LICENSE` at the repository root governs every build in it.

    Planet Climate Sandbox — a terrestrial climate model you can play with
    Copyright (C) 2026 m1omg

    This program is free software: you can redistribute it and/or modify it under the
    terms of the GNU General Public License as published by the Free Software Foundation,
    either version 3 of the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful, but WITHOUT ANY
    WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
    PARTICULAR PURPOSE. See the GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along with this
    program. If not, see <https://www.gnu.org/licenses/>.

It was MIT until this commit. Copyleft is the deliberate choice: this model is worth
reading and worth arguing with, and a fork that improves the physics should come back
readable rather than disappear into something closed. Because the whole program is
plain ES modules served as source, every visitor already receives the corresponding
source of the version they are running.

**The surface maps are not covered by this.** `assets/bodies/` carries third-party
imagery, and it keeps its own terms — none of it becomes GPL by sitting in this
repository. Per file, in [`assets/bodies/CREDITS.md`](../assets/bodies/CREDITS.md): the
Earth, Mars and Venus colour maps are **CC BY 4.0** (Solar System Scope, from NASA
imagery), the Earth height map is **CC BY-SA 4.0**, and Titan's Cassini mosaic and Mars's
MOLA topography are **public domain** as NASA works. Attribution for the first four is a
condition of using them; keep `CREDITS.md` with any copy.
