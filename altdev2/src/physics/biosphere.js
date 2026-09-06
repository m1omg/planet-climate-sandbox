// Who is actually living here, split the one way that matters.
//
// The `biosphere` control is a rate: how hard oxygenic photosynthesis is being
// run, and it is an input to the chemistry. This is a different question and it
// is an output -- given the climate this planet has, how much of it could be
// inhabited, and by what kind of thing.
//
// Two kinds, because on this planet's history there are two, and the boundary
// between them is the sharpest one biology has:
//
//   PROKARYOTES are almost unkillable. They need liquid water and a source of
//   electrons and very little else. The temperature record is Methanopyrus
//   kandleri at 122 C under pressure; the cold record is metabolism in brine
//   films at -20 C and below. They do not need oxygen -- most of Earth's
//   history had none -- and they do not need light, because chemolithotrophs
//   in the deep subsurface make a living off rock and water. On Earth they
//   appeared within a few hundred million years of there being an ocean and
//   have never once been absent since.
//
//   EUKARYOTES are not. They are aerobes: the mitochondrion is the whole point
//   of them, and it burns oxygen. Nothing eukaryotic is known to complete its
//   life cycle without it. They are also far less thermotolerant -- the record
//   is a fungus at about 62 C, and most give up nearer 45 -- because their
//   membranes and their much larger genomes come apart sooner. And they were
//   late: the Great Oxidation is at 2.4 Gya, unambiguous eukaryotic fossils at
//   1.6, and the gap is not an accident of preservation. Building one takes an
//   endosymbiosis, which happened once.
//
// So a world can be teeming and have nothing on it more complicated than a
// bacterium, which is what Earth was for half its life, and that is the
// distinction this draws. Nothing here feeds back into the physics: it reads the
// climate and reports. Life that changed the climate would be the `biosphere`
// control, and that already exists.

import { clamp, smoothstep } from './constants.js';
import { NBANDS } from './climate.js';

// Oxygen a eukaryote needs, in bar. The lower bound is where aerobic
// respiration becomes worth having at all and the upper is where it stops being
// the limit: Sperling et al. (2015) put the animal threshold somewhere between
// 0.1% and 4% of present atmospheric level, and 0.21 bar is present level.
const O2_EUK_LO = 0.001 * 0.21;
const O2_EUK_HI = 0.04 * 0.21;

// How long each takes to arrive, and how fast it recovers ground.
//
// The prokaryote number is abiogenesis plus radiation, and on the one planet
// with data it is fast: pillow lavas and carbon isotopes put life at 3.8 Gya or
// earlier, within a few hundred million years of the ocean. The eukaryote
// number is the endosymbiosis, and on the same planet it is slow -- eight
// hundred million years of an oxygenated atmosphere before anything eukaryotic
// is unambiguous in the record.
//
// Recolonisation is far faster than origination in both cases, so the walk is
// asymmetric: a population that has somewhere to go gets there on an ecological
// timescale, and one that has to be invented waits.
const PRO_ORIGIN = 3.0e8;      // yr
const EUK_ORIGIN = 8.0e8;      // yr
const SPREAD = 2.0e6;          // yr, filling ground that is already habitable

// How long a population takes to disappear once it has nowhere left to live,
// which is NOT one number, because the two ways of running out of habitat are
// not alike.
//
// Ice advancing over a biosphere is a retreat into refugia -- brine channels in
// the sea ice, hydrothermal vents, the deep subsurface -- and Snowball Earth is
// the standing proof that it does not sterilise a planet: everything alive now
// came through one. Megayears is the right timescale for that, and it is what
// SPREAD was already doing.
//
// Heat has no refuge. Past about 400 K there is no known chemistry that holds a
// cell together, proteins denature in minutes, and the ocean is the thing doing
// the cooking -- there is nowhere to be that is cooler. This model was applying
// the refugia timescale to that case too, so a world whose ocean had reached
// 278 C read 100% prokaryote coverage, and went on reading it for a million
// years, because the population was relaxing towards zero with a 2 Myr time
// constant. The readout was not wrong about the room being zero. It was wrong
// about how long dying takes.
const HEAT_DEATH = 20;         // yr, once every band is well past the limit
const HEAT_MARGIN = 20;        // K past the ceiling for the full rate

// ...and the other half of that asymmetry: what a frozen world keeps.
//
// Under a kilometre of sea ice there is liquid water at the pressure-melting
// point, and under that there are hydrothermal vents, and neither of them cares
// what the surface is doing. Snowball Earth is the standing case -- the ice
// reached the equator, this model reads -56 C in its warmest band, and the
// biosphere came through it, which is why there is anything here to argue
// about. Scoring habitat off surface temperature alone said zero and then
// sterilised the planet over the following ten million years.
//
// Four percent is a token: small, out of sight, and not none. It is gated on
// there actually being an ice cover, so a world whose ocean is boiling rather
// than frozen gets nothing from it -- there is no refuge from heat.
//
// Prokaryotes only. Eukaryotes came through the Cryogenian too and this does
// not let them, which is a known simplification rather than a claim: a model
// with one number for "under the ice" cannot also say which of the two things
// living there was more fragile.
const REFUGIA = 0.04;

// Below this a population is gone rather than rare, and has to be originated
// again rather than recovering. Without it a world that sterilised itself kept
// an infinitesimal seed and sprang back the moment it was habitable, which is
// not what a sterilised planet does.
const EXTINCT = 1e-4;

// The share of the surface each could occupy right now, as it stands.
//
// Band by band, because habitability is local: a world whose mean is 60 C can
// still have temperate poles, and a world whose mean is 15 C can have none.
export function habitableShare(w) {
  const dg = w.diag;
  // No liquid water anywhere is the end of both stories. `liquidAllowed` is the
  // triple point -- below about 6 mbar there is no liquid at any temperature --
  // and the ocean term is whether there is any to be liquid.
  const water = smoothstep(0, 0.004, w.water.ocean + w.water.seaIce * 0.25)
              * (dg.liquidAllowed ?? 1);
  if (!(water > 0)) return { pro: 0, euk: 0 };

  // Oxygen, for the eukaryotes only, and taken from the atmosphere as a whole
  // rather than band by band -- it mixes.
  const air = smoothstep(O2_EUK_LO, O2_EUK_HI, dg.pO2 ?? 0);

  let pro = 0, euk = 0, hotPro = 0, hotEuk = 0;
  for (let i = 0; i < NBANDS; i++) {
    const T = w.T[i];
    // How far past the top of the tolerance this band is, area-averaged. Only
    // the hot side is tracked: see HEAT_DEATH for why the cold side is not
    // symmetric with it.
    hotPro += Math.max(0, T - 400) / NBANDS;
    hotEuk += Math.max(0, T - 338) / NBANDS;
    // -20 C to 122 C, the two measured records, with the edges softened over
    // ten kelvin because a hard cutoff would make the readout flicker across a
    // band boundary as the climate drifted.
    const proBand = smoothstep(248, 258, T) * (1 - smoothstep(390, 400, T));
    // -5 C to 62 C. The cold edge is higher than the prokaryote one because a
    // eukaryotic cell freezes rather than sitting in a brine film, and the warm
    // edge is the fungal record.
    const eukBand = smoothstep(263, 271, T) * (1 - smoothstep(328, 338, T));
    pro += proBand / NBANDS;
    euk += eukBand / NBANDS;
  }
  const iced = (w.water.seaIce + w.water.landIce)
             / Math.max(w.water.ocean + w.water.seaIce + w.water.landIce, 1e-12);
  const subIce = REFUGIA * smoothstep(0.15, 0.6, iced);
  return { pro: clamp(Math.max(water * pro, subIce), 0, 1),
           euk: clamp(water * air * euk, 0, 1),
           hotPro, hotEuk };
}

// One step of the two populations towards what the planet can currently hold.
//
// `w.life` is state, not a diagnostic, and that is deliberate: the interesting
// thing about a biosphere is that it has a history. A world that freezes over
// and thaws is not the same afterwards -- the prokaryotes come back from
// refugia in a few million years and the eukaryotes, if they were lost, take
// most of a billion to be reinvented.
export function stepLife(w, dtYears) {
  const room = habitableShare(w);
  w.lifeRoom = room;
  // First step on a fresh world. A preset that carries a biosphere is a planet
  // that already has one -- asking for oxygenic photosynthesis and then being
  // told there are no cells yet would be absurd -- so it starts inhabited to
  // whatever extent it can be. A world with the control at zero starts sterile
  // and has to originate life, which takes the three hundred million years
  // below and only happens somewhere it could survive.
  if (!w.life) {
    const seeded = (w.params.biosphere ?? 0) > 0;
    w.life = seeded ? { pro: room.pro, euk: room.euk } : { pro: 0, euk: 0 };
  }
  const L = w.life;
  if (!(dtYears > 0)) return;

  for (const k of ['pro', 'euk']) {
    const target = room[k];
    const here = L[k];
    // Eukaryotes cannot arise on a world with nothing to build them out of:
    // the endosymbiosis needs a host and a guest, and both were prokaryotes.
    const seeded = k === 'euk' ? L.pro > 0.05 : true;
    let tau;
    if (target <= here) {
      // Losing ground is quick, and being boiled is quicker. Geometric between
      // the two, so twenty kelvin past the ceiling is already the full rate.
      const over = (k === 'pro' ? room.hotPro : room.hotEuk) || 0;
      tau = SPREAD * Math.pow(HEAT_DEATH / SPREAD,
                              smoothstep(0, HEAT_MARGIN, over));
    } else if (here > EXTINCT && seeded) {
      tau = SPREAD;                             // spreading into new ground
    } else if (seeded) {
      tau = k === 'pro' ? PRO_ORIGIN : EUK_ORIGIN;   // starting from nothing
    } else {
      continue;                                 // nothing to start from
    }
    const relax = 1 - Math.exp(-dtYears / tau);
    let next = here + (target - here) * relax;
    // Origination needs a seed to grow from, and zero times anything is zero.
    if (next < EXTINCT && target > EXTINCT && seeded) next = Math.min(target, EXTINCT * 2);
    L[k] = clamp(next, 0, 1);
    if (L[k] < EXTINCT && target <= 0) L[k] = 0;
  }
  // A world that loses its prokaryotes has lost everything above them too.
  if (L.pro <= 0) L.euk = 0;
}
