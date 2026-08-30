# /dev — the development build

Built by `tools/builddev.mjs` from the `claude/hot-ocean-stability-review-b8xdsz`
branch and served at <https://m1omg.github.io/planet-climate-sandbox/dev/>.

**Do not edit anything in here.** Edit the branch and rebuild:

```bash
node tools/builddev.mjs /path/to/main/checkout
```

`assets/` is deliberately absent: this copy sets `window.__assetBase` to
`../assets/` and borrows the surface maps at the site root, which is 668 KB
instead of 23 MB.

Its saves, preferences and discovery log are its own. `localStorage` is keyed by
origin and not by path, so this copy, the stable site and `/altdev/` shared one
set of keys until `src/game/storage.js` split them — and slot 1 is the autosave,
firing every thirty seconds, so a minute here wrote over a world saved there.
Keys are `planetclimate.dev.*`; the site root keeps the bare ones it has
always used. A namespace opened for the first time copies what was in the shared
keys, so nothing looks lost; it is a copy, and the stable site keeps everything.

Worlds still cross between builds the way they should — the URL hash and the
export file carry parameters rather than physics state.

**This build is knowingly not green** — Goldblatt runaway limit, saturating hot branch, refitted methane, four-band radiation, the two star modes, the prokaryote/eukaryote split and Hycean work in progress — known gaps reported by calibrate.mjs. `selftest.js` has seventeen
standing failures, every one of them a test asserting a deviation the README
names and explains; two of them assert the *old* deviation, since snowball
deglaciation now lands at 140 mbar against the literature's 100–300 where it
used to be thirty times too low. `calibrate.mjs` passes all 28 of its anchors
and reports eight known gaps that never fail.

Two of those gaps were failing anchors until recently and are reclassified
rather than fixed: Earth's pre-industrial temperature, which is 0.79 K warm and
0.26 K of that is the priced cost of methane's band at its published strength;
and CO₂'s forcing per doubling at high concentration, which falls off where the
real thing strengthens because a semi-grey band saturates all at once. Both
print their numbers on every run.

The biosphere is split between prokaryotes and eukaryotes, in the readout's
**Life** bar. Three conditions decide it, each a fact rather than a knob: oxygen
(the mitochondrion is an oxygen-respiring endosymbiont, so an anoxic world has
no eukaryotes at all), heat (none is known above 60 °C where prokaryotes reach
122), and CO₂ (vascular plants starve at 150 ppm where cyanobacteria manage on a
few). Plus one about history: eukaryogenesis happened once and trailed Earth's
oxygen by ~700 Myr, so oxygenating a world here does not hand it a nucleus in
the same breath. A living Earth reads 86/14 against Bar-On et al. 2018's 85/14,
an Archean one 100% prokaryote, and Earth +2.2 Gyr 100% prokaryote again — the
star has brightened, weathering has taken the CO₂, and the plants are gone.

It reports and does not steer: every preset is bit-identical to seventeen
significant figures with it in.

The brightening mode is a flat 10% a gigayear now. It used to drive Gough
(1981) forwards from an age inferred by inverting it, and that relation has a
pole at 16 Gyr: Young Venus crossed it, was dimmed to the bottom of the slider
and reported "brightening −45.3% per Gyr". The starlight slider also
reaches 50 S⊕ now, because GJ 1132 b receives 18.8 and could not be
represented on one that stopped at 4.

`carbonDeep` now means carbon still in the mantle rather than the budget minus
a buffer ratio, which had five presets — Venus and the Hot Ocean world
among them — booting with an empty mantle and their volcanoes off. With
that right, outgassing falls as the mantle empties, so a one-way planet no
longer degasses its whole inventory: Young Venus finishes at 130 bar and a dry
runaway rather than 331 bar and a magma ocean.

A far-future magma ocean crawled at 36.6 kyr/s: pO₂ was sweeping four
decades as the world went anoxic, and the step controller resolved it to a tenth
of the reservoir per step on a planet with no methane for that to matter to.
1 785 117 steps to cross 3.4 Gyr against 26 276 with the bound gated on the
methane, agreeing to four significant figures.

A wet runaway used to crawl at a couple of kiloyears a second with nothing
happening on it: `o2Rate` was missing the oxygen that escaping hydrogen leaves
behind, so the step controller clamped the clock to five-year steps on a world
in a steady balance. Earth at 1.4 S⊕ crossed 500 Myr in 300 001 steps and
now does it in 884.

The Great Oxidation scenario no longer depends on how fast the clock was
running. It used to snowball pole-to-pole at any step cap above about 20 kyr and
deglaciate into a 128 °C hothouse on eleven bar of CO₂; the quasi-static
shortcut in `maxStep` is now off across the ice-albedo bifurcation, and the peak
glaciation agrees to a point from a 2 kyr cap to a 5 Myr one.

A band-overlap refit that closed four more gaps was reverted from this build: it
left a 1.32 S⊕ ocean world with no energy balance at any temperature, which shows
up as cycling in and out of glaciation, and cost fourteen thousand times the
step size on a settled Earth. The README has the full account and there are
three new guards that fail on it.

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
