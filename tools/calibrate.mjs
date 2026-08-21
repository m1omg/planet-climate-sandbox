// Every observational anchor the climate model is meant to hit, in one place,
// with the literature value beside it. Run it after touching anything
// radiative: a change that fixes one anchor almost always moves three others.
//
// Sources for the targets are listed against each line. Where the literature
// gives a range, the range is the target and the check is a range check.
import { Simulation } from '../src/sim/clock.js';
import { EARTH, PRESETS } from '../src/game/presets.js';
import { olr, runawayLimit, planetaryAlbedo, cloudCover } from '../src/physics/radiation.js';

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Equilibrium with CO2 held fixed: the pure radiative + feedback response,
// with the carbonate-silicate thermostat taken out of the picture.
export function eq(params, { pin = true, years = 2e5 } = {}) {
  const sim = new Simulation({ ...params, outgassing: pin ? 0 : params.outgassing });
  const target = sim.world.co2;
  let t = 0;
  while (t < years) {
    const dt = Math.min(20 + t * 0.02, 5000);
    sim.stepOnce(dt); t += dt;
    if (pin) sim.world.co2 = target;
  }
  return sim.world;
}

const rows = [];
function anchor(name, value, lo, hi, unit, source) {
  const ok = value >= lo && value <= hi;
  rows.push({ name, value, lo, hi, unit, source, ok });
}

// ---- radiative, no simulation needed --------------------------------------
{
  const T = 288.15, pH2O = 0.0110, pN2 = 1.0;
  const F = (c) => olr(T, c, pH2O, 1.8e-6, pN2 + c + pH2O);
  anchor('CO2 forcing, 280→560 ppm', F(280e-6) - F(560e-6), 3.3, 4.4, 'W/m²',
    'Myhre 1998: 5.35·ln2 = 3.71; IPCC AR6: 3.93');
  anchor('CO2 forcing, 1120→2240 ppm', F(1120e-6) - F(2240e-6), 3.3, 5.2, 'W/m²',
    'stays ~constant per doubling until the band saturates');
  anchor('CO2 forcing, 280→427 ppm', F(280e-6) - F(427e-6), 1.8, 2.7, 'W/m²',
    '5.35·ln(427/280) = 2.26');
  anchor('Earth OLR at 288.15 K', F(280e-6), 234, 243, 'W/m²', 'observed ~239');
  anchor('Venus OLR at 737 K, 92 bar', olr(737, 92, 0, 0, 92), 149, 173, 'W/m²',
    'observed 160-165');
  const rl = runawayLimit(280e-6, 1.0);
  anchor('Simpson–Nakajima limit', rl.flux, 274, 292, 'W/m²',
    'Goldblatt 2013: 282; Kopparapu 2013: 282');
  anchor('Earth cloud cover', cloudCover(0.0110, 0, 0.35), 0.60, 0.72, '',
    'ISCCP/MODIS ~0.67');
  // Cloud feedback: how the albedo responds to the vapour a 1 K warming adds.
  const optsAt = (pw) => ({ oceanFrac: 0.7, landAlbedo: 0.25, hasWater: true, waterCap: 1,
    glaciated: 0, pH2O: pw, pTot: 1.0 + pw, slowness: 0, subStellar: 0.35 });
  const dpw = 0.0110 * 0.07;      // Clausius-Clapeyron, ~7% per kelvin
  const a1 = planetaryAlbedo(288.15, optsAt(0.0110 - dpw / 2));
  const a2 = planetaryAlbedo(288.15, optsAt(0.0110 + dpw / 2));
  anchor('cloud-amount feedback', 340 * (a1.albedo - a2.albedo) - 0, -0.4, 1.2, 'W/m²/K',
    'IPCC AR6 total cloud feedback +0.42 (+0.12 to +0.72)');
}

// ---- the three worlds we can check against reality -------------------------
const preind = eq({ ...EARTH, co2Bar: 280e-6 });
anchor('Pre-industrial Earth', preind.diag.Tmean - 273.15, 13.2, 14.2, '°C',
  'HadCRUT/ERA5 1850-1900 ≈ 13.7');
anchor('Earth planetary albedo', 1 - preind.diag.absorbed / mean(preind.diag.S), 0.28, 0.31, '',
  'CERES 0.293');
anchor('Earth pole-to-equator range', preind.diag.Tmax - preind.diag.Tmin, 30, 48, 'K',
  'annual mean, 18 equal-area bands: ~38 K');
anchor('Earth ice cover', preind.diag.iceArea, 0.03, 0.14, '',
  'sea ice + ice sheet ≈ 0.10 of the surface');

const modern = eq({ ...EARTH, co2Bar: 427e-6 });
anchor('Modern Earth (equilibrium)', modern.diag.Tmean - 273.15, 14.9, 16.1, '°C',
  '15.1 observed + ~0.4 still in the pipeline');
anchor('warming since pre-industrial', modern.diag.Tmean - preind.diag.Tmean, 1.3, 2.3, 'K',
  'observed 1.45 (WMO 2023), equilibrium response larger');

const doubled = eq({ ...EARTH, co2Bar: 560e-6 });
anchor('ECS (280→560 ppm)', doubled.diag.Tmean - preind.diag.Tmean, 2.3, 4.2, 'K',
  'IPCC AR6 best 3.0, likely 2.5-4.0');

const lgm = eq({ ...EARTH, co2Bar: 190e-6 });
anchor('LGM CO2 alone (190 ppm)', lgm.diag.Tmean - preind.diag.Tmean, -5.0, -1.8, 'K',
  'total LGM cooling -6.1 (Tierney 2020); CO2+own ice albedo is part of it');

const venus = eq(PRESETS.venus.params, { years: 1e5 });
anchor('Venus', venus.diag.Tmean, 697, 777, 'K', 'observed 737');
const mars = eq(PRESETS.mars.params, { years: 1e5 });
anchor('Mars', mars.diag.Tmean, 195, 235, 'K', 'observed ~215');

// ---- how hard is it to force a runaway with CO2 alone? ---------------------
{
  let last = null, ran = null;
  for (const mult of [4, 8, 16, 32, 64, 128, 256, 512]) {
    const w = eq({ ...EARTH, co2Bar: 280e-6 * mult });
    const T = w.diag.Tmean - 273.15;
    if (T > 200 && ran === null) ran = mult;
    if (ran === null) last = { mult, T };
  }
  anchor('CO2 runaway threshold', ran ?? 1024, 64, 1024, '× pre-industrial',
    'Ramirez 2014: stable, nearly runs away at 12x under the most extreme assumptions; Goldblatt 2013: ~100x');
  anchor('T at 79× pre-industrial (0.022 bar)', eq({ ...EARTH, co2Bar: 0.022 }).diag.Tmean - 273.15,
    30, 90, '°C', 'worldbuildingpasta ExoPlaSim: 40 °C at 0.022 bar');
  if (last) console.log(`   (warmest non-runaway sampled: ${last.mult}× → ${last.T.toFixed(1)} °C)`);
}

// ---- report ---------------------------------------------------------------
let bad = 0;
console.log('');
for (const r of rows) {
  if (!r.ok) bad++;
  const v = Math.abs(r.value) >= 100 ? r.value.toFixed(0)
          : Math.abs(r.value) >= 1 ? r.value.toFixed(2) : r.value.toFixed(3);
  console.log(`${r.ok ? '\x1b[32m ok \x1b[0m' : '\x1b[31mOFF \x1b[0m'} ${r.name.padEnd(30)} ${v.padStart(8)} ${r.unit.padEnd(6)} target ${r.lo}…${r.hi}`);
  if (!r.ok) console.log(`     ${'\x1b[2m'}${r.source}${'\x1b[0m'}`);
}
console.log(bad ? `\n\x1b[31m— ${bad} of ${rows.length} anchors off —\x1b[0m`
                : `\n\x1b[32m— all ${rows.length} anchors within their literature ranges —\x1b[0m`);
process.exit(bad ? 1 : 0);
