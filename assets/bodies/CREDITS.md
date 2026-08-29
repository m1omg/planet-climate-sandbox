# Surface maps

Real equirectangular maps of four worlds, resized to 2048×1024 and — for the
height map — remapped so its distribution matches the procedural terrain's, so
the same sea-level function puts the coast in the right place on both. See
`tools/buildbodies.py`, which is the whole transform.

| file | body | source | licence |
|---|---|---|---|
| `earth.jpg` | Earth, natural colour | [Solar System Scope](https://www.solarsystemscope.com/textures/) (from NASA imagery) | CC BY 4.0 |
| `mars.jpg` | Mars, natural colour | [Solar System Scope](https://www.solarsystemscope.com/textures/) (from NASA imagery) | CC BY 4.0 |
| `venus.jpg` | Venus, Magellan radar surface | [Solar System Scope](https://www.solarsystemscope.com/textures/) (from NASA imagery) | CC BY 4.0 |
| `titan.jpg` | Titan, Cassini global infrared mosaic | NASA/JPL-Caltech/Univ. Arizona, [PIA22770](https://photojournal.jpl.nasa.gov/catalog/PIA22770) | public domain |
| `earth_height.png` | Earth, topography and bathymetry | Andrewbdfe on Wikimedia Commons, from [NASA Visible Earth](https://visibleearth.nasa.gov/) | CC BY-SA 4.0 |
| `mars_height.png` | Mars, MOLA topography | MGS MOLA MEGDR `megt90n000eb.img`, 16 px/deg, [NASA PDS Geosciences Node](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) | public domain (NASA) |

Titan's mosaic is monochrome infrared; the colours here are a Titan palette
applied to that brightness, not measured colour. Under its haze the surface is
not visible in the optical at all.

Two topographies are here. Earth's is used by every build; `mars_height.png`
was added for /altdev and the root and /dev builds do not reference it, so
adding it changed nothing for them.

Venus and Titan keep procedural relief under their real albedo, because a
plausible-looking but wrong surface is worse than an honest invented one --
Magellan's radar altimetry is not a clean grayscale DEM at this size, and
Titan's is barely mapped at all.

Mars's is the MOLA MEGDR grid, straight off the PDS in signed 16-bit metres
above the areoid, and it checks out against the planet: 21171 m at 17.3 N,
227.0 E is Olympus Mons, and -8177 m at 32.8 S, 62.2 E is the Hellas floor.

The one thing that is not obvious is the longitude origin. MEGDR starts at 0 E;
the Solar System Scope colour map is centred on 0, so its left edge is 180 E,
and the two are rolled half a width apart. Getting that wrong puts Olympus Mons
in Elysium. It was settled by stacking the two and looking -- the albedo's
Olympus ring lands on the DEM's peak at exactly one offset. An albedo-elevation
cross-correlation does NOT settle it, and answers 244 E with a sharp peak and
r = -0.40: what varies across Mars's face is dust, not relief.
