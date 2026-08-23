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
    // Below a thousandth of an ocean, "0.000 EO" says nothing; a global layer a
    // few centimetres deep says a great deal. Metres, then, at the dry end.
    // The precision thresholds sit just below the round numbers on purpose: a
    // boundary at exactly 1 would round 0.9999 up to "1.00" while still
    // choosing the three-decimal branch, and the label would then disagree with
    // itself.
    fmt: (v) => v <= 0 ? 'none'
      : v < 1e-3 ? `${(v * 2750).toFixed(v * 2750 < 0.9995 ? 3 : 2)} m`
      : `${v.toFixed(v < 0.09995 ? 4 : v < 0.9995 ? 3 : 2)} EO`,
    units: { eo: 1, ocean: 1, oceans: 1, m: 1 / 2750, km: 1000 / 2750 },
    unitFor: (v) => (v > 0 && v < 1e-3 ? 'm' : 'EO'),
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
    // 47.95, not 48: at 47.98 the hours branch rounds the label to "48.0 h",
    // which the days branch would have written as "2 d".
    fmt: (v) => v < 47.95 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(0)} d`,
    units: { h: 1, hr: 1, hrs: 1, hour: 1, hours: 1, d: 24, day: 24, days: 24, yr: 8766, year: 8766 },
    unitFor: (v) => (v < 47.95 ? 'h' : 'd'),
    // Rotation rate and synchronisation are different questions; the toggle
    // below the sliders asks the second one.
    note: 'Slow rotators grow a thick reflective cloud deck and move heat much more freely. Rotation alone does not make a world synchronous — Venus turns once every 243 days and still sees the sun everywhere. Use the tidal-lock switch for that.' },
  { g: 'star', key: 'obliquity', label: 'Axial tilt', min: 0, max: 90, step: 0.5,
    fmt: (v) => `${v.toFixed(1)}°`, units: { '°': 1, deg: 1, degrees: 1 } },

  { g: 'atmo', key: 'n2Bar', label: 'Nitrogen & argon', min: 0, max: 20, log: true, zero: true, live: 'n2',
    fmt: fmtBar, units: PRESSURE_UNITS, unitFor: (v) => (v >= 1e-3 ? 'bar' : 'µbar'),
    note: 'The gas that neither condenses nor absorbs: 0.78 bar of it on Earth. Radiatively inert, but it broadens everything else’s absorption lines.' },
  { g: 'atmo', key: 'o2Bar', label: 'Oxygen', min: 0, max: 2, log: true, zero: true, live: 'o2',
    fmt: (v) => v >= 0.01 ? fmtBar(v) : ppm(v), units: PRESSURE_UNITS, unitFor: pressureUnitFor,
    note: 'Made by life, consumed by volcanic gases and by weathering rock. Set the biosphere below the volcanoes and it stays at nothing however long you wait — that threshold is the Great Oxidation.' },
  { g: 'atmo', key: 'co2Bar', label: 'Carbon dioxide', min: 0, max: 100, log: true, zero: true, live: 'co2',
    fmt: (v) => v >= 0.01 ? fmtBar(v) : ppm(v), units: PRESSURE_UNITS, unitFor: pressureUnitFor,
    note: 'Evolves on its own: volcanoes add it, weathering removes it, cold traps freeze it out.' },
  { g: 'atmo', key: 'ch4Bar', label: 'Methane', min: 0, max: 1, log: true, zero: true, live: 'ch4',
    fmt: (v) => v >= 0.01 ? fmtBar(v) : ppm(v), units: PRESSURE_UNITS, unitFor: pressureUnitFor,
    note: 'What is in the air now, not what stays. Life makes most of it and the interior a little; oxygen cuts its life from twelve thousand years to ten, so an oxygenated world holds almost none.' },

  { g: 'surface', key: 'landAlbedo', label: 'Ground brightness', min: 0.05, max: 0.6,
    fmt: (v) => v.toFixed(2), note: 'Dark basalt 0.10 · rock 0.25 · bright sand 0.40' },
  { g: 'surface', key: 'biosphere', label: 'Photosynthetic biosphere', min: 0, max: 4, zero: true,
    fmt: (v) => v <= 0 ? 'none' : `${v < 0.0995 ? Number(v.toPrecision(2)) : v.toFixed(2)}× Earth`,
    units: { x: 1, '×': 1, earth: 1, earths: 1 }, unitFor: () => '× Earth',
    note: 'How hard photosynthesis runs — what you are asking for. What the planet can actually support is below, and past about 73 °C it is nothing: that is where the photosystems come apart and no phototroph on Earth lives above it.',
    extra: `
      <div class="supply">
        <div class="supply-bar"><i id="bio-fill"></i></div>
        <span id="bio-left" class="supply-left">alive</span>
      </div>` },
  { g: 'surface', key: 'emissions', label: 'Industrial CO₂', min: 0, max: 10, zero: true,
    fmt: (v) => v <= 0 ? 'none'
      : `${v < 0.0995 ? Number(v.toPrecision(2)) : v.toFixed(2)}× today`,
    units: { x: 1, '×': 1, today: 1, gt: 1 / 40, gtco2: 1 / 40, 'gtc': 1 / 10.9 },
    unitFor: () => '× today',
    note: 'Burning fossil carbon: 40 Gt of CO₂ a year at 1×, some forty times every volcano on the planet. It runs on a finite reserve — about 5000 Gt of carbon, four and a half centuries at today’s rate — and then stops on its own.',
    // Rendered under the slider. The reserve is the thing that makes this
    // control unable to run a world away, so it is worth being able to see it
    // go down, put it back, and ask what happens if it never runs out.
    extra: `
      <div class="supply">
        <div class="supply-bar"><i id="fossil-fill"></i></div>
        <span id="fossil-left" class="supply-left">100 %</span>
        <button type="button" id="btn-fossil-reset" class="supply-btn"
                title="Put the fossil carbon back in the ground">Refill</button>
        <label class="supply-inf" title="Ignore the reserve and keep burning for ever. Not how a planet works — but a fair thing to ask.">
          <input type="checkbox" id="chk-fossil-inf"> unlimited
        </label>
      </div>` },
  { g: 'surface', key: 'outgassing', label: 'Volcanic outgassing', min: 0, max: 20, log: true, zero: true,
    // Two decimals called a hundredth of Earth's volcanism "0.00× Earth",
    // which reads as dead when it is not.
    fmt: (v) => v <= 0 ? 'dead'
      : `${v < 0.0995 ? Number(v.toPrecision(2)) : v.toFixed(2)}× Earth`,
    units: { x: 1, '×': 1, earth: 1, earths: 1 }, unitFor: () => '× Earth',
    note: 'The CO₂ source, and a trickle of abiotic methane. Your one lever inside a snowball — and enough of it holds a world anoxic against its own biosphere.' },
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
    // Longest first, so "mbar" is never read as "m"; and a known unit at the
    // *start* counts, because several labels carry a trailing word -- "30 %
    // land", "1.0× Sun". Without that, the panel could not read back its own
    // labels: "1 % land" came out as 1, not 0.01.
    const keys = Object.entries(d.units)
      .map(([u, mult]) => [u.replace(/[⊕\s]/g, '').toLowerCase(), mult])
      .sort((a, b) => b[0].length - a[0].length);
    for (const [key, mult] of keys) {
      if (key && (unit === key || unit.startsWith(key))) return n * mult;
    }
  }
  return d.parseScale ? n * d.parseScale : n;   // unknown suffix: take the number
}

// log/linear mapping for the range inputs (0..1000 internally)
// The slider has a thousand positions. Spread over a logarithmic range that is
// about half a percent a step, so the position nearest "1.200 S⊕" really sets
// 1.1975 -- the label rounds it back to what you asked for, but the planet gets
// the other number. Dragging to a value and typing the same value therefore
// produced two different climates, and half a percent of starlight is about a
// watt per square metre, which close to a threshold decides the outcome.
//
// Snapping the slider to the precision its own label shows makes the number you
// read the number in use, so both routes agree exactly.
export function snapToDisplay(d, v) {
  if (!isFinite(v) || v === 0) return v;
  // Definitionally: land where typing the label would land. If the label cannot
  // be read back -- or reads back as something quite different, which would mean
  // the unit was misparsed -- leave the value alone rather than corrupt it.
  const label = d.fmt(v);
  const typed = parseValue(d, label, v);
  if (typed === null || !isFinite(typed)) return v;
  // Accept only if the snap leaves the label unchanged. That is the invariant
  // worth having -- what you read is what is set -- and it rejects the case
  // where the label's unit came back misread, which would move the value by
  // orders of magnitude rather than by a rounding.
  return d.fmt(typed) === label ? typed : v;
}

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
