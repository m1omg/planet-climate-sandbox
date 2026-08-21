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

Titan's mosaic is monochrome infrared; the colours here are a Titan palette
applied to that brightness, not measured colour. Under its haze the surface is
not visible in the optical at all.

Only Earth ships topography. It is the one body with a clean grayscale DEM at a
usable size and a licence that allows redistribution; a plausible-looking but
wrong Mars would be worse than an honest procedural one, so Mars, Venus and
Titan keep procedural relief under their real albedo.
