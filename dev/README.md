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

**This build is knowingly not green** — Goldblatt runaway limit, saturating hot branch, refitted methane, four-band radiation, the two star modes and Hycean work in progress — known gaps reported by calibrate.mjs. `selftest.js` has seventeen
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

The brightening mode is a flat 10% a gigayear now. It used to drive Gough
(1981) forwards from an age inferred by inverting it, and that relation has a
pole at 16 Gyr: Young Venus crossed it, was dimmed to the bottom of the slider
and reported "brightening −45.3% per Gyr". The starlight slider also
reaches 50 S⊕ now, because GJ 1132 b receives 18.8 and could not be
represented on one that stopped at 4.

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
