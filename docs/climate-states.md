# Climate states: the exact conditions

Reference for `src/physics/classify.js`. Every state the game can name, the test that
selects it, and what the quantities in that test actually mean. Nothing here is new
behaviour — it is a transcription of the classifier as it stands.

## How the classifier works

`classify(w)` is a **single if/else-if chain evaluated in order, first match wins**. That
ordering is load-bearing: a planet at 1500 K with no air is a magma ocean, not an airless
rock, because `magma` is tested first. Reading any one condition in isolation overstates
it — every branch also carries the implicit negation of everything above it.

The chain runs once per frame off the diagnostics of the current state. It has no memory:
there is no hysteresis, no "was a snowball last frame", no minimum dwell time. A planet
sitting exactly on a threshold will flicker between two names, and that is a property of
the classifier, not a bug in the physics.

That is still true of the classifier and is no longer true of everything it reads. Since
the hot-layer work, `w.hotLayer` — how much of a planet's water has joined the atmospheric
column — is a state variable with its own history, so two worlds under identical stars can
present different diagnostics to this chain depending on which way they arrived. The chain
itself remains a pure function of what it is handed; the memory lives upstream of it.

## The quantities it tests

| Symbol in the code | Meaning | Units |
| --- | --- | --- |
| `T` = `dg.Tmean` | Band-mean surface temperature, unweighted mean over the 18 equal-area bands | K |
| `Tsub`, `Tanti` | Mean of the 4 bands nearest the substellar and antistellar points. On a rotating world the band coordinate is latitude, so these are equator and pole instead | K |
| `pTot` = `dg.pTotMean` | Band-mean **total** surface pressure — N₂ + CO₂ + CH₄ + O₂ + H₂O | bar |
| `dg.pN2` | Nitrogen partial pressure | bar |
| `water` = `dg.totalWater` | The whole surface inventory: ocean + sea ice + land ice + vapour | Earth oceans (EO) |
| `initialWater` | `w.waterInitial ?? p.water` — what the world started with | EO |
| `liquidShare` | `w.water.ocean / water` — what fraction of the inventory is liquid *right now*. 0 when there is no water at all | 0–1 |
| `dg.flooded` | Fraction of the surface actually under water, derived from the water in the basins and the basin geometry. Vapour covers nothing; floating sea ice still fills its basin | 0–1 |
| `ice` = `dg.iceMean` | Band-mean of `iceFraction(T) = 1 − smoothstep(252, 276, T)`. **How much of the planet is below freezing**, soft-edged over a 24 K ramp. Zero on a world with no water at all | 0–1 |
| `dg.iceArea` | How much is actually *covered* in ice (what the albedo sees). Not used by the classifier — it drives the readout and the subtitle | 0–1 |
| `warmSub` | `1 − iceFraction(Tsub)`: is the substellar point warm enough for liquid. Says nothing about whether water is *there* | 0–1 |
| `temperateBands` | Count of bands with 275 K < T < 320 K — neither boiling nor frozen | 0–18 |
| `lossPerGyr` | Hydrogen escape expressed as oceans lost per Gyr at the current rate | EO/Gyr |
| `lam` = `lockFactor(p)` | 1 if tidally locked, 0 otherwise. Every `lam > 0.5` test below reads simply "is this world locked" | 0 or 1 |
| `collapsed` | `co2Frozen > 0.25 × (co2 + co2Frozen)` **and** `co2Frozen > 1e-3`: a quarter of the CO₂ inventory is lying on the ground as dry ice, and there is a meaningful amount of it | boolean |
| `p.landFraction` | The land fraction as configured | 0–1 |

Note the difference between `ice` and `water`: **`ice` is a temperature statement, `water`
is an inventory statement.** Modern Mars is `ice = 1.0` and `iceArea = 0.019`. That gap is
what the frost-overpaint fix was about.

## The chain, in order

### 1. Magma Ocean
```
T > 1400
```
Nothing else is checked. Above roughly 1400 K silicates melt.

### 2. Airless Rock
```
pTot < 0.0015 bar  AND  water < 0.05 EO
```
Both are required — a thin atmosphere over a wet world is not airless.

### 3. Partial Nightside Freeze-Out / Nightside Freeze-Out / Mars-Like Collapse
```
collapsed  AND  pTot < 0.2 bar  AND  T < 265 K
    → not locked                                     : 'marslike'
    → locked, liquidShare > 0.02 AND flooded > 0.01  : 'nightfrost'
    → locked, otherwise                              : 'nightfrozen'
```
The air itself has frozen onto the ground. The first split is geometric, not thermal: a
rotating world freezes its air onto the *winter* pole and gets it back in spring (a pressure
equilibrium against seasonal caps), a locked world freezes it onto a hemisphere that never
sees the star and nothing ever brings it back.

The second split is how far the collapse has got. **Partial Nightside Freeze-Out** is the state while
it is under way, and its day side still has a sea — which is what makes it worth a name of
its own, and is now a condition rather than a hope: the state's own text promises a working
ocean, so the test requires one. **Nightside Freeze-Out** is the end of that same process —
air on the dark hemisphere as dry ice, water frozen beside it, no liquid water anywhere and a
bare day side. It is not row 11, *Nightside-Trapped Desert*, where the atmosphere is intact
and only the water has migrated.

`T < 265` on the locked branch is admittedly the wrong quantity — the mean of a +58 °C day
and a −145 °C night is a number nowhere on the planet. It stays because it is what makes
this a *collapse* rather than an ordinary eyeball with a cold trap: the whole world has to
be cold on balance, not just the far side.

### 4. Dry Runaway Greenhouse
```
T > 470 K  AND  water < 0.06 × max(initialWater, 0.05)
```
Venus. The water test is **relative to what the planet started with**, floored at 0.05 EO
so a world that began nearly dry cannot qualify on a technicality.

### 5. Wet Runaway Greenhouse
```
T > 420 K
```
Reached only if the dry test above failed, i.e. the water is still here. Between 420 and
470 K the world is wet-runaway regardless of inventory.

### 6. Moist Greenhouse
```
lossPerGyr > 0.015 EO/Gyr  AND  T > 305 K  AND  water > 0.01 EO
```
Still liquid, but the cold trap has failed and hydrogen is escaping steadily. This is the
only state defined by a *rate of change* rather than a state variable.

### 7. Titan-Like
```
T < 130 K  AND  pN2 > 0.3 bar
```
Too cold for liquid water, thick enough nitrogen for something else to run on the surface.

### 8. Baked Desert / Frozen Desert (the dry branch)
```
water < 0.015 EO
    → 'baked'  if T > 290 K
    → 'frozen' otherwise
```
Below 0.015 EO the world has no meaningful water cycle and only its temperature is left to
describe it. Everything after this point on the chain has at least this much water.

### 9. Twilight World
```
locked  AND  Tsub > 340 K  AND  Tanti < 265 K  AND  temperateBands ≥ 2
       AND  liquidShare > 0.02  AND  water > 0.015 EO  AND  flooded < 0.25
```
A boiling eye, a glacial night side, and a temperate ring following the terminator in
between. `flooded < 0.25` is the land-planet requirement, and it is imposed rather than
emergent: this model's locked aquaplanet still shows a 163 K day–night contrast against the
land planet's 201 K — the right direction, nowhere near enough to close the habitable band.
Reproducing the rest needs moisture transport a 1-D diffusive model does not have, so the
criterion carries the published result (Lobo et al. 2023) instead of pretending to derive it.

### 10. Eyeball World / Lobster State
```
locked  AND  warmSub > 0.25  AND  ice > 0.25  AND  liquidShare > 0.05
    → count openBands = bands with iceFraction(T) < 0.5
    → 'lobster' if openBands / 18 > 0.55, else 'eyeball'
```
`liquidShare > 0.05` is what makes this a sunlit **sea** rather than a sunlit warm spot.
Without it this branch swallowed every dry locked world with a warm day side.

### 11. Nightside-Trapped Desert
```
locked  AND  liquidShare < 0.05  AND  water > 0.02 EO
       AND  flooded < 0.04  AND  Tsub > 255 K
```
The inventory is intact; it is all on the far side as glacier ice, and the sunlit face
cannot get it back. `flooded < 0.04` is not a duplicate of the liquid test: with a large
inventory, a few percent left liquid is still a real sea, and a label saying "bone dry"
over visible open water would be wrong.

### 12. Thin Cold Desert
```
pTot < 0.05 bar  AND  T < 265 K  AND  water < 0.35 EO
```
Mars today. Distinguished from state 3 by *not* being `collapsed`: the air has not fallen
out of the sky, it is simply all there is.

### 13. Hard Snowball / Frozen Desert
```
ice > 0.93
    → 'frozen'   if water < 0.1 EO
    → 'snowball' otherwise
```
Frozen pole to pole. The water test separates a genuine ice-albedo runaway from a cold dry
rock that was never going to have an ocean.

### 14. Waterbelt / Slushball
```
ice > 0.55
```
Ice deep into the tropics, a narrow band of open equatorial ocean surviving.

### 15. Dune / Desert World
```
(water < 0.12 EO  OR  flooded < 0.01)  AND  250 K < T < 340 K
```
A land planet with a working climate but little surface water — and there are two ways to be
one. Either the world *has* little water, or it has water and nowhere to put it: `flooded`
comes from the basin geometry, and a planet whose ground is all high has no sea at any
inventory. Both look identical from orbit, bare rock with no coastline anywhere, and until
the second clause was added such a world classified as **Temperate & Habitable** with the
globe drawing 100% land. It was found on a terraformed Venus, whose preset shipped with
basin geometry at 1.

The temperature bounds are what keep this honest on a boiling world: there `flooded` is zero
because the ocean is in the sky rather than because there is nowhere to put it, and the
runaway branches above have already claimed that planet.

#### The Dune World preset, exactly

Five fields differ from `EARTH`; everything else is inherited.

| field | Dune World | EARTH |
| --- | --- | --- |
| `landFraction` | **0.98** | 0.3 |
| `water` | **0.03** EO | 1 |
| `insolation` | **1.25** S⊕ | 1 |
| `landAlbedo` | **0.30** | 0.25 |
| `startT` | **300** K | 288.3 |

Inherited unchanged: `mass` 1 M⊕ · `starTemp` 5772 K · `xuvFraction` 3.4e-6 · `rotationHours`
24 · `tidallyLocked` false · `obliquity` 23.5° · `n2Bar` 0.78 · `o2Bar` 0.21 · `co2Bar`
427 ppm · `ch4Bar` 1.9 ppm · `biosphere` 1 · `outgassing` 1 · `internalHeat` 0.092 W/m² ·
`magneticField` 1 · `emissions` 0 · `brightening` 0 · `realisticGeology` false · `startAge`
4.567 Gyr.

Where it settles after 10 Myr: **17.3 °C**, 0.83% of the surface flooded, no ice, 13 ppm CO₂,
0.897 bar total, and it classifies **Dune / Desert World, habitable**. Note the CO₂: the
thermostat has drawn it down to a thirtieth of Earth's, because a warm dry planet weathers
fast — the same mechanism that makes *Hot Ocean · Starlight* sit at 2.22 ppm.

The point of the numbers is the pairing of 1.25 S⊕ with 0.03 EO. That flux would put an
ocean world into a moist greenhouse; this one is temperate on it, because unsaturated air
radiates above the classical runaway limit and a dry stratosphere throttles water loss
(Abe et al. 2011). `landFraction` 0.98 is doing as much work as the water: with Earth-like
basins the same 0.03 EO spreads into wide shallow seas and the air goes wet again.

### 16. Frozen Desert (cold catch-all)
```
T < 250 K
```

### 17. Waterworld
```
landFraction < 0.04  AND  258 K < T < 335 K
```
The only state selected by a *configured* parameter rather than a simulated one.

### 18. Ice-Free Hothouse
```
ice < 0.02  AND  T > 296 K
```
No permanent ice anywhere.

### 19. Temperate & Habitable
Everything that reaches the end of the chain. Roughly: 250 K < T, some ice but under 55%
of the surface below freezing, more than 0.12 EO of water, and enough land to not be a
waterworld.

## The habitability flag

Separate from the state name, and stricter than "temperate":

```
habitable = (temperate | waterworld | dune | eyeball | lobster | hothouse | waterbelt)
            AND water > 0.005 EO
```

Every runaway, every collapse, every frozen or trapped or baked state is excluded by name.
Note that `hothouse` counts as habitable and `twilight` does not, despite the twilight
world having a temperate ring by construction — it is a deliberate conservatism about a
band the 1-D model cannot fully resolve.

## Things worth knowing about the edges

- **Order beats specificity.** `wetRunaway` at T > 420 K is unconditional on water, so a
  world with a trace of water at 450 K is a wet runaway rather than the dry one, until the
  inventory falls under 6% of its start.
- **`ice` is gated on `hasWater`** (`totalWater > 1e-5`). A bone-dry world scores `ice = 0`
  no matter how cold, which is why states 13, 14 and 18 cannot fire on one and why the dry
  branch at step 8 has to come first.
- **No hysteresis in the chain.** Thresholds are hard except where `smoothstep` softens the
  underlying quantity (`iceFraction`, `warmSub`, and now `supercriticalShare`). Flicker at a
  boundary is expected. The hysteresis that exists is in the physics, not here: `hotLayer`
  advances at one rate and retreats at fifty times that, so the *inputs* to this chain can
  differ between a world that heated up and one that cooled down to the same place.
- **Six states are unreachable on a rotating world** — `twilight`, `eyeball`, `lobster`,
  `trapped`, `nightfrost` and `nightfrozen` — and `lockFactor` is a hard 0-or-1 on `p.tidallyLocked` —
  a slowly rotating world is never partially locked as far as the classifier is concerned.
- **The README's list at "Climate states it recognises" used to be incomplete** — it omitted
  `twilight`, `nightfrost`, `thincold`, `baked` and `frozen`. It now carries all twenty-two names
  and points here for the conditions.
