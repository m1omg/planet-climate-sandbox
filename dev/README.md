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

**This build is knowingly not green** — Goldblatt runaway limit, four-band radiation, CO₂ condensation, hydrogen and Hycean work in progress — 18 of 238 self-tests failing. Two of those failures are tests
asserting the *old* deviation: snowball deglaciation now lands at 143 mbar
against the literature's 100–300, where it used to be thirty times too low.

A band-overlap refit that closed four more gaps was reverted from this build: it
left a 1.32 S⊕ ocean world with no energy balance at any temperature, which shows
up as cycling in and out of glaciation, and cost fourteen thousand times the
step size on a settled Earth. The README has the full account and there are
three new guards that fail on it.
