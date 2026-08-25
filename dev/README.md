# /dev — the development build

This directory is a **built copy** of the `claude/project-status-review-mhk04n`
branch, served at <https://m1omg.github.io/planet-climate-sandbox/dev/> so the
work in progress can be looked at without touching the stable site at the root.

It is not the source. Edit the branch, then rebuild this directory from it —
`index.html`, `css/` and `src/`, with two changes to `index.html`:

* `window.__assetBase = "../assets/"` before the module script, so this copy
  borrows the surface maps and textures at the site root rather than shipping a
  second 23 MB of identical JPEGs; and
* the banner across the top, which says what is broken.

`assets/` is deliberately absent for that reason.

**This build is knowingly not green.** At the time of writing 24 of its 213
self-tests fail, all downstream of replacing the semi-grey radiative scheme with
four spectral bands — methane and Titan are still calibrated for the old scheme.
Two of the twenty-four are failing because they assert the *old* deviation:
snowball deglaciation now lands at 143 mbar against the literature's 100–300,
where it used to be thirty times too low.
