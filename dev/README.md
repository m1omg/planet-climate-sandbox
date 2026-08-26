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

**This build is knowingly not green** — four-band radiation with spectral overlap, CO₂ condensation, hydrogen and Hycean work in progress — 15 of 231 self-tests failing, against 19 of 219 before this
round. Every remaining failure is one the branch inherited; the calibration is
at 2 anchors off out of 31, from 4 of 24 with six known gaps. Five of those gaps
closed: the outer edge of the habitable zone, the snowball threshold and its
duration, Earth's inner edge, and the runaway limit's sensitivity to CO₂.
