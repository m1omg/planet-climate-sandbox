// Definitions of every control in the left-hand panel: range, units, how a value
// is displayed, and how a typed value is read back. Kept free of the DOM so the
// parsing rules can be tested on their own.
const fmtBar = (v) => v >= 1 ? `${v.toFixed(v < 10 ? 2 : 0)} bar`
  : v >= 1e-3 ? `${(v * 1e3).toFixed(v * 1e3 < 10 ? 2 : 0)} mbar`
  : `${(v * 1e6).toFixed(0)} µbar`;
const ppm = (v) => v * 1e6 >= 1e4 ? `${(v * 100).toFixed(1)} %` : `${(v * 1e6).toFixed(0)} ppm`;

// Units each control accepts when a value is typed in. The key is what the user
// may write; the value converts it to the internal unit.
const PRESSURE_UNITS = { bar: 1, bars: 1, mbar: 1e-3, mbars: 1e-3, hpa: 1e-3, kpa: 1e-2,
  pa: 1e-5, ubar: 1e-6, 'µbar': 1e-6, ppm: 1e-6, ppb: 1e-9, '%': 1e-2, atm: 1.01325 };
const pressureUnitFor = (v) => (v >= 0.01 ? 'bar' : 'ppm');

export const SLIDERS = [
  { g: 'body', key: 'mass', label: 'Planet mass', min: 0.05, max: 5, log: true,
    fmt: (v) => `${v.toFixed(2)} M⊕`, units: { 'm': 1, 'me': 1, 'm⊕': 1, 'earth': 1, 'earths': 1 },
    note: 'Sets radius, gravity and how well the world holds its air.' },
  { g: 'body', key: 'water', label: 'Water inventory', min: 0, max: 12, log: true, zero: true, live: 'water',
    fmt: (v) => v <= 0 ? 'none' : `${v.toFixed(v < 1 ? 3 : 2)} EO`,
    units: { eo: 1, ocean: 1, oceans: 1, m: 1 / 2750, km: 1000 / 2750 },
    note: '1 EO = one Earth ocean. Tracks what is left as the planet loses water.' },
  { g: 'body', key: 'landFraction', label: 'Basin geometry', min: 0, max: 1,
    fmt: (v) => `${(v * 100).toFixed(0)} % land`, units: { '%': 0.01 }, unitFor: () => '%',
    note: 'How much of this world would stand above the sea at Earth-like water. Actual coverage is worked out from the water it really has — see the readout.' },

  { g: 'star', key: 'insolation', label: 'Starlight received', min: 0.05, max: 4, log: true,
    fmt: (v) => `${v.toFixed(3)} S⊕`,
    units: { s: 1, 'se': 1, 's⊕': 1, 'w/m2': 1 / 1361, 'w/m²': 1 / 1361, w: 1 / 1361 },
    note: 'Relative to Earth. 1 S⊕ = 1361 W/m².' },
  { g: 'star', key: 'starTemp', label: 'Star temperature', min: 2600, max: 9000, step: 10,
    fmt: (v) => `${v.toFixed(0)} K`, units: { k: 1 } },
  { g: 'star', key: 'xuvFraction', label: 'Stellar XUV activity', min: 1e-6, max: 1e-2, log: true,
    fmt: (v) => `${(v / 3.4e-6).toFixed(v / 3.4e-6 < 10 ? 1 : 0)}× Sun`,
    units: { sun: 3.4e-6, suns: 3.4e-6, x: 3.4e-6, '×': 3.4e-6 }, unitFor: () => '× Sun',
    parseScale: 3.4e-6,
    note: 'Drives hydrogen escape. Young suns and red dwarfs are 100–1000× more active.' },
  { g: 'star', key: 'rotationHours', label: 'Rotation period', min: 2, max: 20000, log: true,
    fmt: (v) => v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(0)} d`,
    units: { h: 1, hr: 1, hrs: 1, hour: 1, hours: 1, d: 24, day: 24, days: 24, yr: 8766, year: 8766 },
    unitFor: (v) => (v < 48 ? 'h' : 'd'),
    note: 'Slow rotators grow a thick reflective cloud deck and move heat much more freely.' },
  { g: 'star', key: 'obliquity', label: 'Axial tilt', min: 0, max: 90, step: 0.5,
    fmt: (v) => `${v.toFixed(1)}°`, units: { '°': 1, deg: 1, degrees: 1 } },

  { g: 'atmo', key: 'n2Bar', label: 'Background air (N₂, O₂…)', min: 0, max: 20, log: true, zero: true, live: 'n2',
    fmt: fmtBar, units: PRESSURE_UNITS, unitFor: (v) => (v >= 1e-3 ? 'bar' : 'µbar'),
    note: 'Every gas that neither condenses nor absorbs much: on Earth 0.99 bar of nitrogen, oxygen and argon. Radiatively inert, but it broadens everything else’s absorption lines.' },
  { g: 'atmo', key: 'co2Bar', label: 'Carbon dioxide', min: 0, max: 100, log: true, zero: true, live: 'co2',
    fmt: (v) => v >= 0.01 ? fmtBar(v) : ppm(v), units: PRESSURE_UNITS, unitFor: pressureUnitFor,
    note: 'Evolves on its own: volcanoes add it, weathering removes it, cold traps freeze it out.' },
  { g: 'atmo', key: 'ch4Bar', label: 'Methane', min: 0, max: 1, log: true, zero: true, live: 'ch4',
    fmt: (v) => v >= 0.01 ? fmtBar(v) : ppm(v), units: PRESSURE_UNITS, unitFor: pressureUnitFor },

  { g: 'surface', key: 'landAlbedo', label: 'Ground brightness', min: 0.05, max: 0.6,
    fmt: (v) => v.toFixed(2), note: 'Dark basalt 0.10 · rock 0.25 · bright sand 0.40' },
  { g: 'surface', key: 'outgassing', label: 'Volcanic outgassing', min: 0, max: 20, log: true, zero: true,
    fmt: (v) => v <= 0 ? 'dead' : `${v.toFixed(2)}× Earth`,
    units: { x: 1, '×': 1, earth: 1, earths: 1 }, unitFor: () => '× Earth',
    note: 'The only CO₂ source. Your one lever inside a snowball.' },
];

// Parse a typed value like "0.3 bar", "420ppm", "2 days", "18 %". A bare number
// is read in whatever unit the control is currently displaying, so what you type
// matches what you just saw.
export function parseValue(d, raw, current) {
  let t = String(raw).trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  if (t === 'none' || t === 'dead' || t === '-') return 0;
  const m = t.match(/^([-+]?(?:[0-9]*\.)?[0-9]+(?:e[-+]?[0-9]+)?)\s*(.*)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  let unit = m[2].replace(/[⊕\s]/g, '').replace(/^x/, '×');
  if (!unit) {
    const def = d.unitFor ? d.unitFor(current) : '';
    unit = def.replace(/[⊕\s]/g, '').replace(/^x/, '×').toLowerCase();
  }
  if (!unit) return n;
  if (d.units) {
    for (const [u, mult] of Object.entries(d.units)) {
      const key = u.replace(/[⊕\s]/g, '').toLowerCase();
      if (key === unit) return n * mult;
    }
  }
  return d.parseScale ? n * d.parseScale : n;   // unknown suffix: take the number
}

// log/linear mapping for the range inputs (0..1000 internally)
export function toSlider(d, v) {
  if (d.log) {
    if (d.zero && v <= 0) return 0;
    const lo = Math.log(d.min <= 0 ? d.max * 1e-6 : d.min), hi = Math.log(d.max);
    const t = (Math.log(Math.max(v, Math.exp(lo))) - lo) / (hi - lo);
    return d.zero ? 8 + t * 992 : t * 1000;
  }
  return ((v - d.min) / (d.max - d.min)) * 1000;
}
export function fromSlider(d, s) {
  if (d.log) {
    if (d.zero && s < 8) return 0;
    const lo = Math.log(d.min <= 0 ? d.max * 1e-6 : d.min), hi = Math.log(d.max);
    const t = d.zero ? (s - 8) / 992 : s / 1000;
    return Math.exp(lo + t * (hi - lo));
  }
  const v = d.min + (s / 1000) * (d.max - d.min);
  return d.step ? Math.round(v / d.step) * d.step : v;
}
