// What is alive on this planet, and which of the two kinds of life it is.
//
// Two things live here. Where photosynthesis can run at all, which used to sit
// in volatiles.js and sets the size of the whole biosphere; and the split of
// that biosphere between prokaryotes and eukaryotes, which is new.
//
// The split is a diagnostic. It reads the biosphere, the oxygen and the
// temperature and reports what kind of life they add up to; it does not feed
// back on any of them. That is deliberate rather than lazy: the one coupling
// worth having -- that an anoxic, prokaryote-only world is the methane-rich one
// -- is ALREADY in the model, as the oxygen dependence of the methane flux in
// volatiles.js. Wiring it a second time through a prokaryote fraction would
// double-count the same physics and move every methane anchor calibrate.mjs
// holds. So this reports; it does not steer.
//
// Three things decide the split, and each is a fact rather than a knob.
//
//   OXYGEN. The mitochondrion is what makes a eukaryote, and it is an
//     oxygen-respiring endosymbiont. Prokaryotes need none: the first two
//     billion years of Earth's life were anaerobic. The eukaryote record starts
//     well after the Great Oxidation Event, not with it -- oxygen at 2.4 Ga,
//     crown-group eukaryotes at about 1.7. See eukaryoteOxygen().
//
//   HEAT. Sixty degrees separate the two domains, and it is the least ambiguous
//     fact about them. See habitat().
//
//   CARBON. Vascular land plants are eukaryotes and they starve at 150 ppm,
//     which is where carbonLimit() already parts them from the cyanobacteria
//     that manage on a few. So a world whose star brightens until weathering has
//     taken its CO2 loses its eukaryotes first and keeps a microbial one for a
//     long time after -- which is the actual end of Earth\u2019s biosphere as it is
//     usually reconstructed.
//
// And one that is a fact about history rather than about conditions: becoming a
// eukaryote happened ONCE, and took time. See EUK_ESTABLISH.
//
// The numbers to hit are Bar-On, Phillips & Milo (2018), who put Earth\u2019s
// standing biomass at about 550 Gt C: plants 450, bacteria 70, archaea 7, fungi
// 12, protists 4, animals 2. Eukaryotes 85%, prokaryotes 14%. An Archean world
// should read 100% prokaryote, and a modern one 86/14.
import { clamp, smoothstep } from './constants.js';
import { NBANDS } from './climate.js';

// Where oxygenic photosynthesis can actually run, as a fraction of the surface.
//
// The bounds are deliberately optimistic: the question is where it is
// *possible*, not where it is comfortable, so each one is the record rather
// than the median.
//
//   temperature  -20 to +73 C. The top is a hard and well-measured limit --
//     oxygenic photosynthesis stops around 73 C, where Synechococcus lividus
//     gives out in the Yellowstone springs, and no phototroph on Earth passes
//     75. The bottom is set by liquid water in brine films rather than by the
//     chemistry: Antarctic cryptoendoliths and snow algae fix carbon at -10 to
//     -20 C.
//   light        the compensation point is astonishingly low. Green sulphur
//     bacteria have been recovered photosynthesising in the Black Sea on about
//     a ten-thousandth of full sunlight, so a fraction of a watt is generous
//     even by the standards of this function.
//   carbon       two constituencies with very different limits, and lumping them
//     was wrong at the starvation end. Marine phytoplankton and cyanobacteria run
//     carbon-concentrating mechanisms and manage on a few ppm. Vascular land
//     plants do not: C3 photosynthesis has a compensation point near 50 ppm, most
//     of it is severely carbon-limited below about 150, and nothing vascular runs
//     below 10 -- which is the CO2-starvation bound on the far end of a
//     biosphere's life, and the reason a brightening star ends one by weathering
//     rather than by heat. See PLANT_HI/PLANT_LO.
//   water        liquid, and enough of it to be a habitat.
//
// Taken band by band rather than from the global mean, because that is how the
// condition actually works. A world whose average is -30 C can still have a
// warm equatorial belt doing the whole planet's photosynthesis, and a tidally
// locked world has a night side where the light term is zero however warm the
// air is.
// Where land plants give out, and where the microbes that are not plants do not.
//
// 150 ppm is where most vascular plants are already carbon-starved and 10 ppm is
// where the last of them stop; C3's compensation point sits near 50 in between.
// Marine phytoplankton keep going to a few ppm on their carbon-concentrating
// mechanisms, so a world does not lose its whole biosphere at 10 ppm -- it loses
// the land half of it, and how big that half is depends on how much land there
// is.
const PLANT_HI = 150e-6, PLANT_LO = 10e-6;      // bar
const MICROBE_HI = 8e-6, MICROBE_LO = 1e-6;     // bar
// Land is about 2.7 times as productive per square metre as open ocean, which is
// what puts 54% of Earth's net primary production on 30% of its surface (Field
// et al. 1998: 56.4 Pg C/yr terrestrial against 48.5 marine). Anchored there and
// then let to run: a landless world is all plankton, a desert world all plants.
const LAND_NPP = 2.7;
export function carbonLimit(pCO2, landFraction) {
  const L = clamp(landFraction, 0, 1);
  const landShare = LAND_NPP * L / Math.max(LAND_NPP * L + (1 - L), 1e-12);
  const plants = smoothstep(PLANT_LO, PLANT_HI, pCO2);
  const microbes = smoothstep(MICROBE_LO, MICROBE_HI, pCO2);
  return landShare * plants + (1 - landShare) * microbes;
}

export function photosynthesis(w, hab) {
  const dg = w.diag;
  const water = smoothstep(0, 0.015, w.water.ocean);
  if (water <= 0) return 0;
  const carbon = carbonLimit(dg.pCO2 ?? 0, w.params.landFraction ?? 0.3);
  if (carbon <= 0) return 0;
  // How much of the planet can actually photosynthesise -- and, crucially, out
  // of how much.
  //
  // Summing habitable bands over the whole globe is the right question for a
  // rotating world and the wrong one for a locked world, because the two get
  // their insolation in different currencies. insolationProfile() hands a
  // rotating planet the *diurnal mean*: every band is lit, and the fact that
  // each one is dark half the time is already averaged in. A locked planet gets
  // the instantaneous value, so half its bands sit at exactly zero for ever.
  // Score both against the whole globe and a locked world is charged twice for
  // its night -- once in the model's own physics, and again in a denominator
  // that counts ground the star can never reach as ground life failed to use.
  //
  // Integrate properly and the two come out level. A locked world lights half
  // its area continuously; Earth lights all of its area half the time. Same
  // starlight intercepted, pi R^2 F either way, and since photosynthesis is
  // light-saturated well below full sunlight -- the `lit` threshold below is
  // half a watt, and green sulphur bacteria manage on a ten-thousandth of
  // Earth's -- what limits production is habitable area, not flux. So a locked
  // world whose entire day side is temperate and wet should read the same as
  // Earth, and one with a habitable ring should read as the share of its day
  // that ring covers.
  //
  // Hence: the denominator is the part of the planet the star ever reaches.
  // `litArea` is exactly 1 on every rotating world -- the dimmest band on Earth
  // still gets 204 W/m^2, and even a 90-degree obliquity leaves 17 -- so this
  // changes nothing anywhere except where a permanent night side exists, which
  // is the only place it was wrong.
  const h = hab || habitat(w);
  if (h.litArea <= 0) return 0;    // a world its star never reaches at all
  return water * carbon * (h.share / h.litArea);
}

// The band-by-band part, split out because two questions need it and neither
// should ask it twice: how much of the planet can photosynthesise at all, and
// how much of *that* is warm enough for a eukaryote. `eukShare` differs from
// `share` in one term only -- the ceiling -- so the ratio between them is
// exactly the share of the habitable planet a nucleus is allowed into.
//
// Where the two ceilings come from: oxygenic photosynthesis stops around 73 C
// and the loop's 68-78 C rolloff straddles that. No eukaryote of any kind lives
// near it. The hottest ones known are fungi at about 60 C (Tansey & Brock 1972
// put the eukaryotic limit at 62), while prokaryotes keep going to 122 --
// Methanopyrus kandleri strain 116, Takai et al. 2008. Sixty degrees of margin
// between the two domains, and it is the least ambiguous fact about them.
export function habitat(w) {
  const dg = w.diag;
  let share = 0, eukShare = 0, litArea = 0;
  for (let i = 0; i < NBANDS; i++) {
    const T = w.T[i];
    const warm = smoothstep(248, 258, T);            // -25 to -15 C
    const cool = 1 - smoothstep(341, 351, T);        // +68 to +78 C
    const euk = 1 - smoothstep(328, 338, T);         // +55 to +65 C
    const lit = smoothstep(0.05, 0.5, dg.S ? dg.S[i] : 1361);
    // Written out long rather than factored through a shared `warm * lit`: the
    // total is what every calibration anchor is measured against, and floating
    // point does not promise that (a*b*c)/n and ((a*c)/n)*b agree in the last
    // bit. Keeping the original expression keeps `share` bit-identical to what
    // it was before this loop had a second question to answer.
    share += (warm * cool * lit) / NBANDS;
    eukShare += (warm * euk * lit) / NBANDS;
    litArea += lit / NBANDS;
  }
  return { share, eukShare, litArea };
}

// How fast a biosphere dies, and how slowly it comes back.
//
// Dying is the quick one: past 73 C the photosystems come apart and a forest is
// gone in a season, so a couple of centuries is already generous for a whole
// planet's worth. Coming back is the slow one -- somewhere has to have survived
// and spread. Neither timescale is visible above about a kiloyear a second, but
// they are the right way round, and it means a world that dips over the edge and
// comes back does not simply flicker.
export const BIO_DIE = 200;      // yr
export const BIO_GROW = 5000;    // yr

// ---------------------------------------------------------------------------
// Prokaryotes and eukaryotes
// ---------------------------------------------------------------------------

// Earth's present oxygen, because the literature on when a eukaryote can exist
// is written in "% PAL" and in nothing else.
export const O2_PAL = 0.2095;        // bar

// Earth's standing biomass, for turning a fraction into a number anybody can
// picture. Bar-On, Phillips & Milo 2018.
export const EARTH_BIOMASS_GTC = 550;

// The oxygen a eukaryote needs, on a log scale, because that is how the evidence
// reads: the question is always which ORDER OF MAGNITUDE of PAL, never which
// per cent.
//
// 0.1% PAL at the bottom -- below that nothing aerobic runs at ecosystem scale.
// The classic Pasteur point is Berkner & Marshall's 1% PAL (1965); it is now
// thought too high for the origin of aerobic metabolism and about right for
// aerobic ecosystems, and it sits inside this ramp rather than at either end.
// 20% PAL at the top: the Neoproterozoic Oxygenation Event took Earth past
// roughly 10% PAL, and that is when eukaryotes stopped being a minor component
// and the animals radiated.
//
// What this gets right without being asked to: the Proterozoic. At 1% PAL the
// ramp returns 0.40, so the boring billion comes out as a world that HAS
// eukaryotes and is still mostly run by bacteria. That is what the rock record
// says, and it is not a number anything here was fitted to.
const EUK_O2_LO = -3, EUK_O2_HI = -0.7;        // log10 of PAL
export function eukaryoteOxygen(pO2) {
  if (!(pO2 > 0)) return 0;
  return smoothstep(EUK_O2_LO, EUK_O2_HI, Math.log10(pO2 / O2_PAL));
}

// Of the photosynthesis a given CO2 allows, how much can be done by something
// with a nucleus.
//
// carbonLimit() above already splits its two constituencies -- vascular plants,
// which starve at 150 ppm, against the cyanobacteria and carbon-concentrating
// phytoplankton that manage on a few -- and the first of those is the eukaryotic
// one. So this is that same split read as a ratio, and it costs nothing new: a
// brightening star that weathers a world's CO2 away takes its eukaryotes first
// and leaves a microbial biosphere running for a long time afterwards.
export function eukaryoteCarbon(pCO2, landFraction) {
  const L = clamp(landFraction, 0, 1);
  const landShare = LAND_NPP * L / Math.max(LAND_NPP * L + (1 - L), 1e-12);
  const plants = smoothstep(PLANT_LO, PLANT_HI, pCO2);
  const microbes = smoothstep(MICROBE_LO, MICROBE_HI, pCO2);
  const total = landShare * plants + (1 - landShare) * microbes;
  return total > 0 ? clamp(plants / total, 0, 1) : 0;
}

// The share of any biosphere that stays prokaryotic however good conditions get.
//
// Not a fudge factor -- it is where Earth's 77 Gt C of bacteria and archaea
// actually are. Most of it is the deep subsurface, which no eukaryote occupies
// at all; the rest is anoxic sediment and the open-ocean picoplankton size class
// that Prochlorococcus owns because a cell carrying a nucleus cannot be that
// small. 14% puts a fully oxygenated temperate world at Bar-On's 86/14.
const PROK_REFUGE = 0.14;

// How long becoming a eukaryote takes, once there is oxygen to do it with.
//
// The one term here about history rather than conditions. Eukaryogenesis
// happened once in four billion years, and on Earth it trailed the oxygen that
// made it possible by some seven hundred million: the Great Oxidation Event is
// 2.4 Ga, unambiguous crown-group eukaryotes 1.7-1.6. An exponential on 300 Myr
// is 90% of the way there after 700, which is the right delay and the right
// shape -- and it is why oxygenating a world in this model does not handed it
// eukaryotes in the same breath.
//
// It ratchets. Losing the oxygen again does not un-evolve a nucleus: the gate
// takes care of a world that suffocates, and the lineage waits in whatever is
// left of it. Only sterilising the planet outright resets this.
const EUK_ESTABLISH = 3e8;   // yr
const BIO_DEAD = 1e-3;       // x Earth, below which there is nothing to wait in

// The largest share of a living biosphere that eukaryotes could hold here.
export function eukaryoteCeiling(w, hab) {
  const dg = w.diag;
  const h = hab || habitat(w);
  if (!(h.share > 0)) return 0;
  const heat = clamp(h.eukShare / h.share, 0, 1);
  const carbon = eukaryoteCarbon(dg.pCO2 ?? 0, w.params.landFraction ?? 0.3);
  return (1 - PROK_REFUGE) * eukaryoteOxygen(dg.pO2 ?? 0) * heat * carbon
    * clamp(w.eukReady ?? 0, 0, 1);
}

// One step of the split. Reads w.bio, which stepVolatiles has already advanced.
export function stepBiology(w, dtYears, hab) {
  const dt = Math.max(dtYears, 0);
  const gate = eukaryoteOxygen(w.diag.pO2 ?? 0);

  // A world that opens already oxygenated opens with its eukaryotes. Earth is a
  // preset, and spending the first few hundred million years of a session as a
  // bacterial mat would be a bug rather than a history lesson.
  if (w.eukReady == null) w.eukReady = gate;
  else {
    // Mutually exclusive, and that matters: a sterile planet that still holds
    // its dead atmosphere's oxygen -- a snowball, say -- satisfies both of these
    // at once, and running them both left the ratchet pushing readiness back up
    // as fast as the reset pulled it down. A world with nothing alive on it is
    // not slowly evolving a nucleus.
    const k = 1 - Math.exp(-dt / EUK_ESTABLISH);
    if ((w.bio ?? 0) <= BIO_DEAD) w.eukReady -= w.eukReady * k;
    else if (gate > w.eukReady) w.eukReady += (gate - w.eukReady) * k;
  }

  // Nothing to divide up yet, and it matters that this returns rather than
  // seeding a zero. w.bio is null until the first step has run, so a zero here
  // would be a NUMBER where a null belongs: the first real step would then find
  // w.euk already set and relax it up from nothing on the 5 kyr growth clock,
  // and a brand-new Earth would read 28% eukaryote for its first few thousand
  // years instead of 86. The whole and its halves are seeded together or not at
  // all. (eukReady above is not part of that -- it is a fact about the planet's
  // oxygen rather than a share of its biosphere, and a world that opens
  // oxygenated should open knowing it.)
  if (w.bio == null) return;

  const alive = Math.max(w.bio, 0);
  const target = alive * eukaryoteCeiling(w, hab);
  if (w.euk == null) w.euk = target;
  else {
    const tau = target < w.euk ? BIO_DIE : BIO_GROW;
    w.euk += (target - w.euk) * (1 - Math.exp(-dt / tau));
  }
  // Never more of them than there is biosphere for them to be part of: w.bio
  // can fall faster than this relaxes, and a negative prokaryote count is not a
  // thing.
  w.euk = clamp(w.euk, 0, alive);
}
