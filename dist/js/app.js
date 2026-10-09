/*
 * Melody & Drum Studio
 *
 * A melody generator and a step-sequencer drum machine built on the
 * Web Audio API. No dependencies.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // | Helpers                                                           |
  // ---------------------------------------------------------------------

  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const chance = (p) => Math.random() < p;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const mod = (n, m) => ((n % m) + m) % m;
  const $ = (id) => document.getElementById(id);

  // Picks a value from `[[value, weight], ...]`.
  function weighted(entries) {
    const total = entries.reduce((sum, e) => sum + e[1], 0);
    let r = Math.random() * total;
    for (const [value, weight] of entries) {
      r -= weight;
      if (r < 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  // ---------------------------------------------------------------------
  // | Music theory                                                      |
  // ---------------------------------------------------------------------

  // Ticks per quarter note. 48 divides evenly into 16ths (12),
  // 8th-note triplets (16) and 16th-note triplets (8).
  const TPQ = 48;

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // `rel` is the semitone offset of the relative major (for the MIDI key signature).
  // Pentatonic and blues scales borrow chords from a seven-note `harmony` scale.
  const SCALES = {
    major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], rel: 0 },
    minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10], rel: 3, minor: true },
    harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], rel: 3, minor: true },
    dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], rel: 10, minor: true, modal: true },
    phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], rel: 8, minor: true, modal: true },
    lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], rel: 7, modal: true },
    mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], rel: 5, modal: true },
    majorPentatonic: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9], rel: 0, harmony: 'major' },
    minorPentatonic: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10], rel: 3, minor: true, harmony: 'minor' },
    blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10], rel: 3, minor: true, harmony: 'mixolydian' },
  };

  // Chord progressions for modal scales, as scale degrees (0 = tonic).
  const MODAL_PROGS = {
    dorian: [[0, 3, 0, 3], [0, 3, 6, 0], [0, 6, 3, 0]],
    phrygian: [[0, 1, 0, 1], [0, 1, 6, 0]],
    lydian: [[0, 1, 0, 1], [0, 1, 4, 0]],
    mixolydian: [[0, 6, 3, 0], [0, 6, 0, 3]],
  };

  const RHYTHMS = {
    straight: 'Straight',
    syncopated: 'Syncopated',
    dotted: 'Dotted',
    swing: 'Swing',
    triplet: 'Triplets',
    sparse: 'Sparse / long notes',
    dense: 'Running 16ths',
    arpeggio: 'Arpeggiated',
    offbeat: 'Offbeat (skank)',
    tresillo: 'Tresillo (3+3+2)',
  };

  const SOUNDS = {
    lead: 'Saw lead',
    pluck: 'Pluck',
    keys: 'Electric piano',
    bell: 'FM bell',
    pad: 'Soft pad',
  };

  // Genre profiles drive every setting the user leaves on Random.
  const GENRES = {
    pop: {
      name: 'Pop', bpm: [92, 128],
      scales: [['major', 6], ['minor', 3], ['majorPentatonic', 2], ['mixolydian', 1]],
      rhythms: [['straight', 4], ['syncopated', 4], ['dotted', 2], ['offbeat', 1]],
      meters: [['4/4', 12], ['3/4', 1], ['6/8', 1]],
      prog: {
        major: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4]],
        minor: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4]],
      },
      sound: 'pluck', leap: 0.25, rest: 0.08,
    },
    rock: {
      name: 'Rock', bpm: [100, 150],
      scales: [['major', 4], ['minor', 3], ['minorPentatonic', 3], ['mixolydian', 2]],
      rhythms: [['straight', 5], ['dotted', 2], ['syncopated', 2]],
      meters: [['4/4', 12], ['6/8', 1], ['3/4', 1]],
      prog: {
        major: [[0, 3, 4, 3], [0, 4, 3, 0], [0, 3, 0, 4]],
        minor: [[0, 5, 6, 0], [0, 6, 5, 6], [0, 3, 6, 0]],
      },
      sound: 'lead', leap: 0.3, rest: 0.08,
    },
    jazz: {
      name: 'Jazz', bpm: [90, 180],
      scales: [['major', 3], ['dorian', 3], ['minor', 1], ['lydian', 1], ['mixolydian', 1]],
      rhythms: [['swing', 6], ['triplet', 2], ['syncopated', 2]],
      meters: [['4/4', 10], ['3/4', 3], ['5/4', 1]],
      prog: {
        major: [[1, 4, 0, 0], [0, 5, 1, 4], [2, 5, 1, 4], [0, 3, 1, 4]],
        minor: [[1, 4, 0, 0], [0, 3, 1, 4]],
      },
      sound: 'keys', leap: 0.45, rest: 0.1, sevenths: true, swing: { unit: 24, ratio: 0.66 },
    },
    blues: {
      name: 'Blues', bpm: [70, 120],
      scales: [['blues', 5], ['minorPentatonic', 3], ['mixolydian', 1]],
      rhythms: [['swing', 4], ['triplet', 4], ['dotted', 1]],
      meters: [['4/4', 8], ['12/8', 4]],
      prog: { major: [[0, 3, 0, 0], [0, 3, 0, 4], [4, 3, 0, 4]] },
      sound: 'lead', leap: 0.3, rest: 0.15, sevenths: true, swing: { unit: 24, ratio: 0.66 },
    },
    funk: {
      name: 'Funk', bpm: [92, 115],
      scales: [['dorian', 4], ['mixolydian', 3], ['minorPentatonic', 3]],
      rhythms: [['syncopated', 6], ['dense', 2], ['offbeat', 2]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 3, 0, 3], [0, 0, 3, 3]], minor: [[0, 3, 0, 3], [0, 6, 3, 0]] },
      sound: 'pluck', leap: 0.3, rest: 0.18, sevenths: true, swing: { unit: 12, ratio: 0.56 },
    },
    hiphop: {
      name: 'Hip-hop', bpm: [80, 98],
      scales: [['minor', 4], ['dorian', 2], ['minorPentatonic', 2], ['harmonicMinor', 1], ['phrygian', 1]],
      rhythms: [['syncopated', 4], ['sparse', 2], ['dotted', 2], ['arpeggio', 1]],
      meters: [['4/4', 1]],
      prog: {
        major: [[0, 5, 3, 4]],
        minor: [[0, 5, 2, 6], [0, 3, 0, 4], [0, 5, 3, 4], [0, 0, 5, 5]],
      },
      sound: 'keys', leap: 0.25, rest: 0.2, sevenths: true, swing: { unit: 12, ratio: 0.58 },
    },
    trap: {
      name: 'Trap', bpm: [130, 160],
      scales: [['minor', 4], ['harmonicMinor', 3], ['phrygian', 2]],
      rhythms: [['triplet', 3], ['sparse', 3], ['syncopated', 2], ['arpeggio', 2]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 5, 3, 4]], minor: [[0, 5, 4, 0], [0, 5, 2, 4], [0, 0, 5, 6]] },
      sound: 'bell', leap: 0.3, rest: 0.25,
    },
    lofi: {
      name: 'Lo-fi', bpm: [70, 90],
      scales: [['major', 2], ['dorian', 3], ['minor', 2], ['majorPentatonic', 2]],
      rhythms: [['sparse', 3], ['syncopated', 3], ['swing', 2], ['dotted', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[3, 2, 1, 0], [1, 4, 0, 5], [3, 4, 2, 5]], minor: [[0, 3, 6, 2], [1, 4, 0, 0]] },
      sound: 'keys', leap: 0.3, rest: 0.2, sevenths: true, swing: { unit: 12, ratio: 0.6 },
    },
    edm: {
      name: 'EDM / House', bpm: [118, 130],
      scales: [['minor', 5], ['major', 3], ['minorPentatonic', 2]],
      rhythms: [['offbeat', 3], ['syncopated', 3], ['arpeggio', 3], ['dense', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[5, 3, 0, 4], [0, 4, 5, 3]], minor: [[0, 5, 2, 6], [5, 3, 0, 4], [0, 6, 5, 6]] },
      sound: 'lead', leap: 0.25, rest: 0.1,
    },
    reggae: {
      name: 'Reggae', bpm: [70, 90],
      scales: [['major', 4], ['minor', 2], ['mixolydian', 1], ['majorPentatonic', 2]],
      rhythms: [['offbeat', 5], ['syncopated', 2], ['dotted', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 3, 0, 4], [0, 3, 4, 3], [0, 5, 3, 4]], minor: [[0, 3, 0, 3], [0, 6, 5, 6]] },
      sound: 'keys', leap: 0.25, rest: 0.15, swing: { unit: 12, ratio: 0.58 },
    },
    latin: {
      name: 'Latin', bpm: [90, 130],
      scales: [['minor', 3], ['harmonicMinor', 2], ['major', 3], ['phrygian', 1]],
      rhythms: [['tresillo', 6], ['syncopated', 3]],
      meters: [['4/4', 8], ['6/8', 2]],
      prog: { major: [[0, 4, 4, 0], [0, 3, 4, 0]], minor: [[0, 3, 4, 0], [0, 6, 5, 4]] },
      sound: 'pluck', leap: 0.3, rest: 0.1,
    },
    classical: {
      name: 'Classical', bpm: [60, 132],
      scales: [['major', 4], ['minor', 2], ['harmonicMinor', 3]],
      rhythms: [['straight', 3], ['dotted', 2], ['arpeggio', 2], ['triplet', 1]],
      meters: [['4/4', 6], ['3/4', 5], ['2/4', 2], ['6/8', 2]],
      prog: { major: [[0, 3, 4, 0], [0, 5, 1, 4], [0, 1, 4, 0]], minor: [[0, 3, 4, 0], [0, 5, 3, 4]] },
      sound: 'keys', leap: 0.35, rest: 0.05,
    },
    ambient: {
      name: 'Ambient', bpm: [60, 90],
      scales: [['lydian', 3], ['major', 2], ['majorPentatonic', 3], ['dorian', 2]],
      rhythms: [['sparse', 8], ['straight', 1]],
      meters: [['4/4', 5], ['3/4', 2], ['6/8', 2], ['5/4', 1]],
      prog: { major: [[0, 3, 0, 3], [0, 5, 3, 0]], minor: [[0, 5, 3, 6]] },
      sound: 'pad', leap: 0.4, rest: 0.25, sevenths: true,
    },
    prog: {
      name: 'Prog / Math rock', bpm: [100, 150],
      scales: [['minor', 3], ['dorian', 2], ['lydian', 2], ['phrygian', 1]],
      rhythms: [['syncopated', 3], ['dense', 2], ['straight', 2], ['dotted', 1]],
      meters: [['7/8', 4], ['5/4', 3], ['7/4', 2], ['9/8', 1], ['11/8', 1], ['5/8', 1]],
      prog: { major: [[0, 1, 4, 5]], minor: [[0, 5, 6, 0], [0, 3, 5, 6]] },
      sound: 'lead', leap: 0.4, rest: 0.1,
    },
  };

  const LENGTHS = { short: 4, medium: 8, long: 16 };

  // Moods tilt whatever the user leaves on Random toward a feeling, on top
  // of the genre: scale and rhythm weights multiply with the genre's, tempo
  // scales the genre's range. `leap` scales how far the melody jumps,
  // `rest` adds or removes space, `register` moves it up or down (semitones).
  const MOODS = {
    happy: {
      name: 'Happy', tempo: 1.1, leap: 1, rest: 0, register: 0,
      scales: [['major', 5], ['majorPentatonic', 4], ['lydian', 1], ['mixolydian', 1]],
      rhythms: [['straight', 3], ['syncopated', 3], ['offbeat', 2], ['dotted', 1]],
      sounds: ['pluck', 'bell'],
    },
    sad: {
      name: 'Sad', tempo: 0.8, leap: 0.8, rest: 0.06, register: -5,
      scales: [['minor', 5], ['harmonicMinor', 2], ['dorian', 1], ['minorPentatonic', 1]],
      rhythms: [['sparse', 4], ['straight', 2], ['dotted', 2]],
      sounds: ['keys', 'pad'],
    },
    dark: {
      name: 'Dark', tempo: 0.9, leap: 1, rest: 0.05, register: -12,
      scales: [['phrygian', 4], ['harmonicMinor', 3], ['minor', 2]],
      rhythms: [['sparse', 3], ['syncopated', 2], ['triplet', 2]],
      sounds: ['lead', 'pad'],
    },
    dreamy: {
      name: 'Dreamy', tempo: 0.85, leap: 1.3, rest: 0.04, register: 5,
      scales: [['lydian', 5], ['majorPentatonic', 3], ['major', 1], ['dorian', 1]],
      rhythms: [['sparse', 3], ['arpeggio', 3], ['triplet', 2]],
      sounds: ['pad', 'bell'],
    },
    calm: {
      name: 'Calm', tempo: 0.85, leap: 0.7, rest: 0.05, register: 0,
      scales: [['majorPentatonic', 5], ['major', 2], ['dorian', 1]],
      rhythms: [['sparse', 4], ['straight', 3]],
      sounds: ['keys', 'pad'],
    },
    energetic: {
      name: 'Energetic', tempo: 1.15, leap: 1.1, rest: -0.05, register: 5,
      scales: [['minor', 2], ['major', 2], ['minorPentatonic', 2], ['mixolydian', 1]],
      rhythms: [['dense', 3], ['syncopated', 3], ['offbeat', 2], ['arpeggio', 2]],
      sounds: ['lead', 'pluck'],
    },
    tense: {
      name: 'Tense', tempo: 1.05, leap: 1.4, rest: 0, register: 0,
      scales: [['harmonicMinor', 4], ['phrygian', 3], ['minor', 1]],
      rhythms: [['syncopated', 3], ['dense', 2], ['triplet', 2]],
      sounds: ['lead', 'bell'],
    },
    mysterious: {
      name: 'Mysterious', tempo: 0.9, leap: 1.2, rest: 0.05, register: 0,
      scales: [['dorian', 3], ['phrygian', 2], ['harmonicMinor', 2], ['lydian', 1]],
      rhythms: [['triplet', 3], ['sparse', 3], ['syncopated', 2]],
      sounds: ['bell', 'pad'],
    },
    romantic: {
      name: 'Romantic', tempo: 0.9, leap: 1.1, rest: 0.02, register: 0,
      scales: [['major', 3], ['minor', 2], ['harmonicMinor', 2]],
      rhythms: [['dotted', 3], ['triplet', 2], ['straight', 2]],
      sounds: ['keys'],
    },
    epic: {
      name: 'Epic', tempo: 1, leap: 1.3, rest: 0, register: 5,
      scales: [['minor', 4], ['harmonicMinor', 2], ['dorian', 1]],
      rhythms: [['dotted', 3], ['straight', 2], ['triplet', 2]],
      sounds: ['lead'],
    },
  };

  // Multiplies genre and mood weights; options only one side likes keep a
  // small weight so the result never comes up empty.
  function blendWeights(genreEntries, moodEntries) {
    const g = new Map(genreEntries);
    const m = new Map(moodEntries);
    const keys = new Set([...g.keys(), ...m.keys()]);
    return Array.from(keys, (k) => [k, (g.get(k) || 0.3) * (m.get(k) || 0.15)]);
  }

  function scaleHarmony(scaleKey) {
    const scale = SCALES[scaleKey];
    return scale.harmony ? SCALES[scale.harmony].steps : scale.steps;
  }

  function chordPcs(root, harmony, degree, sevenths) {
    const pcs = [];
    for (let i = 0; i < (sevenths ? 4 : 3); i++) {
      pcs.push(mod(root + harmony[mod(degree + i * 2, 7)], 12));
    }
    return pcs;
  }

  function chordName(pcs) {
    const root = pcs[0];
    const third = mod(pcs[1] - root, 12);
    const fifth = mod(pcs[2] - root, 12);
    let q = third === 3 ? (fifth === 6 ? 'dim' : 'm') : (fifth === 8 ? 'aug' : '');
    if (pcs.length > 3) {
      const seventh = mod(pcs[3] - root, 12);
      if (q === '') q = seventh === 11 ? 'maj7' : '7';
      else if (q === 'm') q = seventh === 11 ? 'm(maj7)' : 'm7';
      else if (q === 'dim') q = seventh === 10 ? 'm7b5' : 'dim7';
      else q = 'aug7';
    }
    return NOTE_NAMES[root] + q;
  }

  // Splits a bar into beat groups (in ticks). Compound meters (6/8, 9/8,
  // 12/8) group in threes; odd meters like 7/8 become 2+2+3.
  function beatGroups(num, den) {
    const unit = (TPQ * 4) / den;
    const groups = [];
    if (den <= 4) {
      for (let i = 0; i < num; i++) groups.push(unit);
    } else if (num % 3 === 0 && num > 3) {
      for (let i = 0; i < num / 3; i++) groups.push(unit * 3);
    } else {
      let left = num;
      while (left > 0) {
        if (left === 3 || left === 1) {
          groups.push(unit * left);
          left = 0;
        } else {
          groups.push(unit * 2);
          left -= 2;
        }
      }
    }
    return groups;
  }

  // ---------------------------------------------------------------------
  // | Rhythm                                                            |
  // ---------------------------------------------------------------------

  // Cells that fill one beat group of a given length in ticks.
  // Negative values are rests.
  const CELLS = {
    straight: {
      24: [[[24], 3], [[12, 12], 1]],
      36: [[[36], 2], [[24, 12], 2], [[12, 12, 12], 1]],
      48: [[[48], 3], [[24, 24], 5], [[24, -24], 0.5]],
      72: [[[72], 1], [[48, 24], 3], [[24, 24, 24], 3]],
      96: [[[96], 1], [[48, 48], 3], [[48, 24, 24], 2], [[24, 24, 48], 1]],
    },
    syncopated: {
      24: [[[12, 12], 2], [[-12, 12], 2], [[24], 1]],
      36: [[[12, 24], 2], [[24, 12], 1], [[-12, 24], 1]],
      48: [[[12, 24, 12], 3], [[-12, 36], 2], [[36, 12], 2], [[-24, 24], 2], [[12, 12, 24], 1], [[24, 24], 1]],
      72: [[[24, 48], 2], [[12, 24, 36], 2], [[36, 36], 2], [[-24, 48], 1]],
      96: [[[36, 36, 24], 3], [[24, 48, 24], 2], [[-24, 24, 48], 1]],
    },
    dotted: {
      24: [[[24], 1], [[12, 12], 1]],
      36: [[[24, 12], 2], [[36], 1]],
      48: [[[36, 12], 5], [[12, 36], 1], [[48], 1]],
      72: [[[48, 24], 3], [[36, 12, 24], 2], [[72], 1]],
      96: [[[72, 24], 3], [[36, 12, 36, 12], 3], [[96], 1]],
    },
    swing: {
      24: [[[24], 1]],
      36: [[[24, 12], 1]],
      48: [[[24, 24], 6], [[48], 2], [[-24, 24], 1]],
      72: [[[24, 24, 24], 3], [[48, 24], 2]],
      96: [[[24, 24, 24, 24], 2], [[48, 24, 24], 2], [[48, 48], 1]],
    },
    triplet: {
      24: [[[24], 1]],
      36: [[[12, 12, 12], 2], [[24, 12], 1]],
      48: [[[16, 16, 16], 5], [[32, 16], 2], [[16, 32], 1], [[-16, 16, 16], 1]],
      72: [[[24, 24, 24], 4], [[48, 24], 2]],
      96: [[[32, 32, 32], 3], [[16, 16, 16, 16, 16, 16], 2], [[64, 32], 1]],
    },
    sparse: {
      24: [[[24], 1], [[-24], 1]],
      36: [[[36], 2], [[-36], 1]],
      48: [[[48], 4], [[-48], 2], [[-24, 24], 1]],
      72: [[[72], 4], [[-72], 1]],
      96: [[[96], 4], [[-96], 1], [[-48, 48], 1]],
    },
    dense: {
      24: [[[12, 12], 1]],
      36: [[[12, 12, 12], 1]],
      48: [[[12, 12, 12, 12], 5], [[24, 12, 12], 2], [[12, 12, 24], 2]],
      72: [[[12, 12, 12, 12, 12, 12], 3], [[24, 12, 12, 24], 1]],
      96: [[[12, 12, 12, 12, 12, 12, 12, 12], 3], [[24, 12, 12, 24, 12, 12], 1]],
    },
    offbeat: {
      24: [[[-12, 12], 1]],
      36: [[[-12, 24], 1]],
      48: [[[-24, 24], 6], [[-24, 12, 12], 2], [[-12, 12, -12, 12], 1]],
      72: [[[-24, 24, 24], 2], [[-24, 48], 1]],
      96: [[[-48, 48], 2], [[-24, 24, -24, 24], 3]],
    },
    tresillo: {
      48: [[[36, 12], 2], [[24, 24], 1]],
      72: [[[24, 24, 24], 1], [[36, 36], 2]],
      96: [[[36, 36, 24], 5], [[36, 12, 24, 24], 2], [[36, 36, 12, 12], 2]],
    },
  };

  // Chance that a note tied over a beat boundary merges with the next one.
  const TIE_PROB = {
    straight: 0.1, syncopated: 0.35, dotted: 0.12, swing: 0.1, triplet: 0.08,
    sparse: 0.4, dense: 0.03, arpeggio: 0, offbeat: 0.15, tresillo: 0.05,
  };

  function plainCell(len) {
    const out = [];
    let left = len;
    while (left >= 24) {
      out.push(24);
      left -= 24;
    }
    if (left) out.push(left);
    return out;
  }

  function cellFor(pattern, len, arpUnit) {
    if (pattern === 'arpeggio') {
      const unit = len % arpUnit === 0 ? arpUnit : 12;
      if (len % unit !== 0) return plainCell(len);
      return new Array(len / unit).fill(unit);
    }
    const table = CELLS[pattern][len];
    return table ? weighted(table).slice() : plainCell(len);
  }

  function groupStarts(groups) {
    const starts = [];
    let pos = 0;
    groups.forEach((len) => {
      starts.push(pos);
      pos += len;
    });
    return starts;
  }

  function ensureNote(items) {
    if (!items.some((it) => !it.rest)) items[0].rest = false;
    return items;
  }

  function makeBarRhythm(ctx) {
    let groups = ctx.groups;
    // Tresillo spans two beats, so pair up quarter-note beats.
    if (ctx.pattern === 'tresillo') {
      const paired = [];
      for (let i = 0; i < groups.length; i++) {
        if (groups[i] === 48 && groups[i + 1] === 48) {
          paired.push(96);
          i++;
        } else {
          paired.push(groups[i]);
        }
      }
      groups = paired;
    }

    const items = [];
    let pos = 0;
    groups.forEach((len) => {
      cellFor(ctx.pattern, len, ctx.arpUnit).forEach((v) => {
        items.push({ start: pos, dur: Math.abs(v), rest: v < 0 });
        pos += Math.abs(v);
      });
    });

    const tieProb = TIE_PROB[ctx.pattern];
    const merged = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const prev = merged[merged.length - 1];
      const cur = items[i];
      if (ctx.strongSet.has(cur.start) && !prev.rest && !cur.rest && chance(tieProb)) {
        prev.dur += cur.dur;
      } else {
        merged.push(cur);
      }
    }

    merged.forEach((it, i) => {
      if (i > 0 && !it.rest && chance(ctx.restProb)) it.rest = true;
    });
    return ensureNote(merged);
  }

  // Small rhythmic edits that keep a repeated motif recognisable.
  function varyRhythm(items) {
    const out = items.map((it) => Object.assign({}, it));
    const ops = randInt(1, 2);
    for (let k = 0; k < ops; k++) {
      const op = pick(['split', 'merge', 'rest']);
      if (op === 'split') {
        const cands = out.map((it, i) => i).filter((i) => !out[i].rest && out[i].dur >= 24 && out[i].dur % 24 === 0);
        if (cands.length) {
          const i = pick(cands);
          const half = out[i].dur / 2;
          const start = out[i].start;
          out.splice(i, 1, { start, dur: half, rest: false }, { start: start + half, dur: half, rest: false });
        }
      } else if (op === 'merge') {
        const cands = out.map((it, i) => i).filter((i) => i < out.length - 1 && !out[i].rest);
        if (cands.length) {
          const i = pick(cands);
          out[i].dur += out[i + 1].dur;
          out.splice(i + 1, 1);
        }
      } else if (out.length > 1) {
        const i = randInt(1, out.length - 1);
        out[i].rest = !out[i].rest;
      }
    }
    return ensureNote(out);
  }

  // A phrase-ending bar: normal rhythm up to the middle, then one held note.
  function cadenceRhythm(ctx) {
    const items = makeBarRhythm(ctx);
    const starts = groupStarts(ctx.groups);
    const cut = starts.length > 1 ? starts[Math.max(1, Math.floor(starts.length / 2))] : 0;
    const out = [];
    for (const it of items) {
      if (it.start >= cut) break;
      const end = it.start + it.dur;
      out.push(end > cut ? Object.assign({}, it, { dur: cut - it.start }) : it);
    }
    out.push({ start: cut, dur: ctx.barTicks - cut, rest: false });
    return out;
  }

  // Bar structure for 4, 8 or 16 bars. Letters are motifs; repeated
  // letters reuse (and sometimes vary) an earlier bar.
  function phrasePlan(bars) {
    const phrase = (a, b, cad, varyB) => [
      { id: a },
      { id: a, vary: true },
      { id: b, vary: !!varyB },
      { id: 'cad', cad },
    ];
    if (bars <= 4) return phrase('A', 'B', 'full');
    if (bars <= 8) return phrase('A', 'B', 'half').concat(phrase('A', 'B', 'full', true));
    return phrase('A', 'B', 'half')
      .concat(phrase('A', 'B', 'half', true))
      .concat(phrase('C', 'D', 'half'))
      .concat(phrase('A', 'B', 'full'));
  }

  // ---------------------------------------------------------------------
  // | Pitch                                                             |
  // ---------------------------------------------------------------------

  // Pitches are scale-degree indices: 0 is the tonic, n is the tonic an
  // octave up, negative values go below.
  const STEP_WEIGHTS = [0.7, 4, 2.2, 1, 0.7, 0.5, 0.3, 0.25];

  function idxPc(ctx, idx) {
    return mod(ctx.root + ctx.steps[mod(idx, ctx.n)], 12);
  }

  function idxToMidi(ctx, idx) {
    return ctx.tonicMidi + 12 * Math.floor(idx / ctx.n) + ctx.steps[mod(idx, ctx.n)];
  }

  function nearestIdx(ctx, from, test) {
    for (let d = 0; d <= ctx.hi - ctx.lo; d++) {
      for (const idx of [from - d, from + d]) {
        if (idx >= ctx.lo && idx <= ctx.hi && test(idx)) return idx;
      }
    }
    return clamp(from, ctx.lo, ctx.hi);
  }

  function choosePitch(ctx, state, chord, strong) {
    const entries = [];
    for (let idx = ctx.lo; idx <= ctx.hi; idx++) {
      const iv = idx - state.prev;
      const dist = Math.abs(iv);
      let w = STEP_WEIGHTS[dist] || 0;
      if (dist >= 3) w *= ctx.leap * 3;
      if (w <= 0) continue;
      const inChord = chord.includes(idxPc(ctx, idx));
      w *= inChord ? (strong ? 4 : 1.5) : (strong ? 0.35 : 1);
      // After a leap, prefer to step back the other way.
      if (Math.abs(state.lastMove) >= 3 && Math.sign(iv) === Math.sign(state.lastMove)) w *= 0.3;
      w *= 1 - 0.7 * Math.min(1, Math.abs(idx - ctx.center) / ctx.span);
      entries.push([idx, w]);
    }
    return entries.length ? weighted(entries) : state.prev;
  }

  function chooseArpPitch(ctx, state, chord) {
    const tones = [];
    for (let idx = ctx.lo; idx <= ctx.hi; idx++) {
      if (chord.includes(idxPc(ctx, idx))) tones.push(idx);
    }
    if (!tones.length) return state.prev;
    if (chance(0.12)) state.dir = -state.dir;
    let next = state.dir > 0 ? tones.find((t) => t > state.prev) : tones.slice().reverse().find((t) => t < state.prev);
    if (next === undefined || next > ctx.center + ctx.span * 0.8 || next < ctx.lo + 1) {
      state.dir = -state.dir;
      next = state.dir > 0 ? tones.find((t) => t > state.prev) : tones.slice().reverse().find((t) => t < state.prev);
    }
    return next === undefined ? state.prev : next;
  }

  function commit(state, idx) {
    state.lastMove = idx - state.prev;
    state.prev = idx;
    return idx;
  }

  function genBarPitches(ctx, state, rhythm, chord) {
    return rhythm.map((note) => {
      if (note.rest) return null;
      const strong = ctx.strongSet.has(note.start);
      const idx = ctx.pattern === 'arpeggio' ? chooseArpPitch(ctx, state, chord) : choosePitch(ctx, state, chord, strong);
      return commit(state, idx);
    });
  }

  // Re-uses a motif's pitches on a (possibly varied) rhythm, transposed
  // by `shift` scale steps and nudged onto chord tones on strong beats.
  function derivePitches(ctx, state, motif, rhythm, shift, chord) {
    return rhythm.map((note) => {
      if (note.rest) return null;
      let src = null;
      let exact = false;
      motif.rhythm.forEach((b, i) => {
        if (b.start <= note.start && motif.pitches[i] !== null) {
          src = motif.pitches[i];
          exact = b.start === note.start;
        }
      });
      const strong = ctx.strongSet.has(note.start);
      if (src === null) return commit(state, choosePitch(ctx, state, chord, strong));
      let idx = src + shift;
      if (!exact) idx += pick([-1, 1]);
      idx = clamp(idx, ctx.lo, ctx.hi);
      if (strong && !chord.includes(idxPc(ctx, idx))) {
        const near = nearestIdx(ctx, idx, (i) => chord.includes(idxPc(ctx, i)));
        if (Math.abs(near - idx) <= 2) idx = near;
      }
      return commit(state, idx);
    });
  }

  // ---------------------------------------------------------------------
  // | Melody generation                                                 |
  // ---------------------------------------------------------------------

  function numeratorFor(den) {
    if (den === 2) return pick([2, 3, 4]);
    if (den === 4) return weighted([[4, 8], [3, 3], [2, 1], [5, 1], [6, 1], [7, 1]]);
    if (den === 8) return weighted([[6, 5], [12, 2], [9, 2], [7, 2], [5, 2], [3, 1]]);
    return weighted([[7, 1], [9, 1], [11, 1], [5, 1], [12, 1], [15, 1]]);
  }

  function denominatorFor(num) {
    if ([6, 9, 12].includes(num)) return weighted([[8, 4], [4, 1]]);
    if ([5, 7, 11, 13, 15].includes(num)) return weighted([[8, 3], [4, 2], [16, 1]]);
    if (num === 2) return weighted([[4, 3], [2, 2]]);
    return weighted([[4, 6], [8, 1], [2, 1]]);
  }

  // Fills every empty setting with a random (genre-aware) choice.
  function resolveSettings(input) {
    const rolled = {};
    const roll = (key, value, fallback) => {
      if (value === '' || value === null || value === undefined) {
        rolled[key] = true;
        return fallback();
      }
      return value;
    };

    const genre = roll('genre', input.genre, () => pick(Object.keys(GENRES)));
    const g = GENRES[genre];
    const mood = roll('mood', input.mood, () => pick(Object.keys(MOODS)));
    const md = MOODS[mood];
    const bpm = roll('bpm', input.bpm, () => clamp(Math.round(randInt(g.bpm[0], g.bpm[1]) * md.tempo), 40, 240));

    let num = input.tsNum;
    let den = input.tsDen;
    if (!num && !den) {
      [num, den] = weighted(g.meters).split('/').map(Number);
      rolled.meter = true;
    } else if (!num) {
      num = numeratorFor(den);
      rolled.meter = true;
    } else if (!den) {
      den = denominatorFor(num);
      rolled.meter = true;
    }

    const root = roll('root', input.root, () => randInt(0, 11));
    const scale = roll('scale', input.scale, () => weighted(blendWeights(g.scales, md.scales)));
    const length = roll('length', input.length, () => pick(Object.keys(LENGTHS)));
    const rhythm = roll('rhythm', input.rhythm, () => weighted(blendWeights(g.rhythms, md.rhythms)));
    const sound = roll('sound', input.sound, () => (chance(0.5) ? g.sound : pick(md.sounds)));

    return { genre, mood, bpm, num, den, root, scale, length, rhythm, sound, rolled };
  }

  function resolveSwing(settings, groups) {
    const g = GENRES[settings.genre];
    let swing = null;
    if (settings.rhythm === 'swing') swing = { unit: 24, ratio: g.swing && g.swing.unit === 24 ? g.swing.ratio : 0.64 };
    else if (!['triplet', 'tresillo', 'arpeggio'].includes(settings.rhythm)) swing = g.swing || null;
    // Swing pairs must line up with the beat groups (not the case in 6/8 etc.).
    if (swing && groups.some((len) => len % (swing.unit * 2) !== 0)) swing = null;
    return swing;
  }

  function generateMelody(input) {
    const s = resolveSettings(input);
    const g = GENRES[s.genre];
    const scale = SCALES[s.scale];
    const steps = scale.steps;
    const n = steps.length;
    const groups = beatGroups(s.num, s.den);
    const barTicks = groups.reduce((a, b) => a + b, 0);
    const bars = LENGTHS[s.length];

    // The mood's register moves the tonic by whole octaves and slides the
    // melody's range by scale steps for the remainder.
    const md = MOODS[s.mood];
    const octaves = Math.trunc(md.register / 12);
    let tonicMidi = (s.root <= 5 ? 60 : 48) + s.root + octaves * 12;
    if (tonicMidi < 45) tonicMidi += 12;
    const slide = Math.round(((md.register - octaves * 12) / 12) * n);
    const lo = -Math.ceil(n * 0.43) + slide;
    const hi = n + Math.ceil(n * 0.72) + slide;
    const ctx = {
      root: s.root,
      steps,
      n,
      lo,
      hi,
      center: Math.round(n * 0.5) + slide,
      span: (hi - lo) / 2,
      tonicMidi,
      leap: g.leap * md.leap,
      pattern: s.rhythm,
      restProb: s.rhythm === 'arpeggio' ? 0 : clamp(g.rest * (s.rhythm === 'sparse' ? 1.4 : 1) + md.rest, 0, 0.5),
      arpUnit: pick([12, 24, 24]),
      groups,
      barTicks,
      strongSet: new Set(groupStarts(groups)),
    };

    const harmony = scaleHarmony(s.scale);
    const progs = scale.modal ? MODAL_PROGS[s.scale] : (scale.minor ? g.prog.minor || g.prog.major : g.prog.major);
    const prog = pick(progs);
    const plan = phrasePlan(bars);

    const state = { prev: pick([0, 2, n > 5 ? 4 : 3]), lastMove: 0, dir: 1 };
    const motifs = {};
    const notes = [];
    const chords = [];

    plan.forEach((spec, bar) => {
      const deg = spec.cad === 'full' ? 0 : prog[bar % prog.length];
      const pcs = chordPcs(s.root, harmony, deg, g.sevenths);
      chords.push({ bar, deg, pcs, name: chordName(pcs) });

      let rhythm;
      let pitches;
      const motif = motifs[spec.id];

      if (spec.cad) {
        rhythm = cadenceRhythm(ctx);
        pitches = genBarPitches(ctx, state, rhythm, pcs);
        const last = pitches.length - 1;
        const before = pitches.slice(0, last).filter((p) => p !== null).pop();
        const from = before === undefined ? state.prev : before;
        const target = spec.cad === 'full' ?
          nearestIdx(ctx, from, (i) => mod(i, n) === 0) :
          nearestIdx(ctx, from, (i) => mod(i, n) !== 0 && pcs.includes(idxPc(ctx, i)));
        pitches[last] = target;
        state.prev = target;
      } else if (motif) {
        rhythm = spec.vary ? varyRhythm(motif.rhythm) : motif.rhythm.map((it) => Object.assign({}, it));
        const degShift = mod(deg - motif.deg + 3, 7) - 3;
        const shift = Math.round((degShift * n) / 7);
        pitches = derivePitches(ctx, state, motif, rhythm, shift, pcs);
      } else {
        rhythm = makeBarRhythm(ctx);
        if (bar === 0) rhythm[0].rest = false;
        pitches = genBarPitches(ctx, state, rhythm, pcs);
        motifs[spec.id] = { rhythm, pitches, deg };
      }

      rhythm.forEach((it, i) => {
        if (pitches[i] === null || it.rest) return;
        const strong = ctx.strongSet.has(it.start);
        notes.push({
          tick: bar * barTicks + it.start,
          dur: it.dur,
          midi: idxToMidi(ctx, pitches[i]),
          vel: clamp((strong ? 0.92 : 0.76) + (Math.random() - 0.5) * 0.12, 0.3, 1),
        });
      });
    });

    return Object.assign(s, {
      notes,
      chords,
      groups,
      barTicks,
      bars,
      totalTicks: bars * barTicks,
      swing: resolveSwing(s, groups),
      sevenths: !!g.sevenths,
    });
  }

  // Maps a straight tick position to its swung position.
  function swingTick(t, swing) {
    if (!swing) return t;
    const pair = swing.unit * 2;
    const base = Math.floor(t / pair) * pair;
    const p = t - base;
    const split = pair * swing.ratio;
    return base + (p <= swing.unit ? (p / swing.unit) * split : split + ((p - swing.unit) / swing.unit) * (pair - split));
  }

  // ---------------------------------------------------------------------
  // | Audio engine                                                      |
  // ---------------------------------------------------------------------

  const audio = { ctx: null };

  function makeImpulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // A short silent WAV. Playing it through an <audio> element while the
  // transport runs makes iOS treat the page as media playback, so sound
  // is not muted by the ring/silent switch.
  function silentWav() {
    const len = 800;
    const bytes = new Uint8Array(44 + len);
    const view = new DataView(bytes.buffer);
    const str = (o, t) => Array.from(t).forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, 36 + len, true);
    str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    str(36, 'data');
    view.setUint32(40, len, true);
    bytes.fill(128, 44);
    let bin = '';
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return `data:audio/wav;base64,${btoa(bin)}`;
  }

  function setMediaSession(active) {
    if (!audio.keepAlive) return;
    if (active) {
      const p = audio.keepAlive.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      audio.keepAlive.pause();
    }
  }

  function resumeAudio() {
    if (audio.ctx && audio.ctx.state !== 'running' && audio.ctx.state !== 'closed') {
      const p = audio.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  function initAudio() {
    if (!audio.ctx) {
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch {
        // Not supported; the silent <audio> element below covers older iOS.
      }
      audio.keepAlive = new Audio(silentWav());
      audio.keepAlive.loop = true;
      audio.keepAlive.setAttribute('playsinline', '');

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      audio.ctx = ctx;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.15;
      comp.connect(ctx.destination);

      audio.master = ctx.createGain();
      audio.master.gain.value = Number($('master-volume').value);
      audio.master.connect(comp);

      audio.melodyBus = ctx.createGain();
      audio.melodyBus.gain.value = Number($('m-volume').value);
      audio.melodyBus.connect(audio.master);

      const reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(ctx, 2.4, 2.8);
      const send = ctx.createGain();
      send.gain.value = 0.22;
      audio.melodyBus.connect(send);
      send.connect(reverb);
      reverb.connect(audio.master);

      audio.drumBus = ctx.createGain();
      audio.drumBus.gain.value = Number($('d-volume').value);
      audio.drumFilter = ctx.createBiquadFilter();
      audio.drumFilter.type = 'lowpass';
      audio.drumFilter.frequency.value = KITS[drum.kit].filter;
      audio.drumFilter.connect(audio.drumBus);
      audio.drumBus.connect(audio.master);

      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      audio.noise = noise;
    }
    resumeAudio();
    return audio.ctx;
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Attack / decay / sustain / release. Returns the time the voice ends.
  function envelope(param, time, dur, peak, a, d, s, r) {
    const sus = Math.max(peak * s, 0.0001);
    param.setValueAtTime(0.0001, time);
    param.linearRampToValueAtTime(peak, time + a);
    param.exponentialRampToValueAtTime(sus, time + a + d);
    const end = Math.max(time + dur, time + a + d);
    param.setValueAtTime(sus, end);
    param.exponentialRampToValueAtTime(0.0001, end + r);
    return end + r;
  }

  function osc(type, freq, time, stop, dest, detune) {
    const o = audio.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.connect(dest);
    o.start(time);
    o.stop(stop);
    return o;
  }

  function playTone(midi, time, dur, vel, sound, dest) {
    const ctx = audio.ctx;
    const f = mtof(midi);
    const amp = ctx.createGain();
    amp.connect(dest);
    let end;

    if (sound === 'lead') {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 4;
      filt.frequency.setValueAtTime(Math.min(f * 8, 12000), time);
      filt.frequency.exponentialRampToValueAtTime(Math.min(f * 3 + 600, 9000), time + 0.25);
      filt.connect(amp);
      end = envelope(amp.gain, time, dur, 0.14 * vel, 0.01, 0.2, 0.7, 0.12);
      osc('sawtooth', f, time, end, filt);
      osc('square', f, time, end, filt, 8);
    } else if (sound === 'pluck') {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 2;
      filt.frequency.setValueAtTime(Math.min(f * 10, 14000), time);
      filt.frequency.exponentialRampToValueAtTime(f * 1.5, time + 0.3);
      filt.connect(amp);
      end = envelope(amp.gain, time, dur, 0.22 * vel, 0.004, 0.35, 0.15, 0.15);
      osc('sawtooth', f, time, end, filt);
      osc('triangle', f * 2, time, end, filt, -5);
    } else if (sound === 'keys') {
      end = envelope(amp.gain, time, dur, 0.28 * vel, 0.005, 1.2, 0.3, 0.3);
      osc('sine', f, time, end, amp);
      const bright = ctx.createGain();
      bright.connect(amp);
      bright.gain.setValueAtTime(0.35, time);
      bright.gain.exponentialRampToValueAtTime(0.02, time + 0.4);
      osc('triangle', f * 2, time, end, bright);
      osc('sine', f * 4, time, end, bright, 4);
    } else if (sound === 'bell') {
      end = envelope(amp.gain, time, dur, 0.24 * vel, 0.002, 1.4, 0.06, 0.5);
      const carrier = osc('sine', f, time, end, amp);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(f * 2.2, time);
      modGain.gain.exponentialRampToValueAtTime(f * 0.1, time + 1);
      modGain.connect(carrier.frequency);
      osc('sine', f * 3.5, time, end, modGain);
    } else {
      // pad
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = Math.min(f * 4, 2400);
      filt.connect(amp);
      end = envelope(amp.gain, time, dur, 0.1 * vel, 0.25, 0.5, 0.8, 0.7);
      osc('sawtooth', f, time, end, filt, -10);
      osc('sawtooth', f, time, end, filt, 10);
      osc('triangle', f / 2, time, end, filt);
    }
  }

  function playChord(chord, time, dur, dest) {
    const ctx = audio.ctx;
    const base = 48 + chord.pcs[0];
    const voices = chord.pcs.map((pc) => {
      let m = 48 + pc;
      while (m < base) m += 12;
      return m;
    });
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1400;
    filt.connect(dest);
    voices.forEach((m) => {
      const amp = ctx.createGain();
      amp.connect(filt);
      const end = envelope(amp.gain, time, dur * 0.96, 0.045, 0.05, 0.6, 0.6, 0.3);
      osc('triangle', mtof(m), time, end, amp);
      osc('sawtooth', mtof(m), time, end, amp, 7);
    });
    // Bass
    const bass = ctx.createGain();
    bass.connect(dest);
    const bassEnd = envelope(bass.gain, time, dur * 0.9, 0.2, 0.01, 0.4, 0.55, 0.15);
    osc('sine', mtof(36 + chord.pcs[0]), time, bassEnd, bass);
    osc('triangle', mtof(36 + chord.pcs[0]), time, bassEnd, bass);
  }

  // ---------------------------------------------------------------------
  // | Drum synthesis                                                    |
  // ---------------------------------------------------------------------

  const KITS = {
    acoustic: { name: 'Acoustic', kickPitch: 120, kickEnd: 50, kickDecay: 0.4, snareTone: 190, snareDecay: 0.2, hatDecay: 0.05, filter: 18000 },
    k808: { name: '808', kickPitch: 110, kickEnd: 38, kickDecay: 1.1, snareTone: 240, snareDecay: 0.16, hatDecay: 0.04, filter: 18000 },
    k909: { name: '909', kickPitch: 170, kickEnd: 48, kickDecay: 0.45, snareTone: 220, snareDecay: 0.22, hatDecay: 0.06, filter: 18000 },
    lofi: { name: 'Lo-fi (dusty)', kickPitch: 105, kickEnd: 48, kickDecay: 0.35, snareTone: 180, snareDecay: 0.18, hatDecay: 0.045, filter: 3800 },
  };

  function noiseSource(time, stop, dest) {
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.noise;
    src.loop = true;
    src.connect(dest);
    src.start(time, Math.random() * 0.5);
    src.stop(stop);
    return src;
  }

  function filter(type, freq, q, dest) {
    const f = audio.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    f.connect(dest);
    return f;
  }

  function decayGain(time, peak, decay, dest) {
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    g.connect(dest);
    return g;
  }

  const DRUM_SYNTHS = {
    kick(t, v, kit, out) {
      const g = decayGain(t, v, kit.kickDecay, out);
      const o = osc('sine', kit.kickPitch, t, t + kit.kickDecay + 0.05, g);
      o.frequency.setValueAtTime(kit.kickPitch, t);
      o.frequency.exponentialRampToValueAtTime(kit.kickEnd, t + 0.12);
      noiseSource(t, t + 0.02, filter('highpass', 3000, 0, decayGain(t, v * 0.25, 0.015, out)));
    },
    snare(t, v, kit, out) {
      noiseSource(t, t + kit.snareDecay + 0.05, filter('highpass', 1400, 0, decayGain(t, v * 0.7, kit.snareDecay, out)));
      const tone = osc('triangle', kit.snareTone, t, t + 0.12, decayGain(t, v * 0.55, 0.1, out));
      tone.frequency.exponentialRampToValueAtTime(kit.snareTone * 0.7, t + 0.1);
    },
    clap(t, v, kit, out) {
      const g = audio.ctx.createGain();
      g.connect(out);
      g.gain.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach((o) => {
        g.gain.setValueAtTime(v * 0.8, t + o);
        g.gain.exponentialRampToValueAtTime(v * 0.15, t + o + 0.009);
      });
      g.gain.setValueAtTime(v * 0.7, t + 0.032);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      noiseSource(t, t + 0.25, filter('bandpass', 1200, 0.9, g));
    },
    rim(t, v, kit, out) {
      osc('triangle', 820, t, t + 0.05, filter('bandpass', 1600, 3, decayGain(t, v * 0.6, 0.04, out)));
      osc('square', 1650, t, t + 0.03, decayGain(t, v * 0.12, 0.02, out));
    },
    chh(t, v, kit, out) {
      if (audio.openHat && audio.openHat.time < t) {
        audio.openHat.gain.gain.cancelScheduledValues(t);
        audio.openHat.gain.gain.setTargetAtTime(0.0001, t, 0.01);
        audio.openHat = null;
      }
      const g = decayGain(t, v * 0.42, kit.hatDecay, out);
      noiseSource(t, t + kit.hatDecay + 0.02, filter('highpass', 7500, 0, filter('peaking', 10000, 1, g)));
    },
    ohh(t, v, kit, out) {
      const g = decayGain(t, v * 0.38, 0.4, out);
      noiseSource(t, t + 0.45, filter('highpass', 7000, 0, g));
      audio.openHat = { gain: g, time: t };
    },
    ltom(t, v, kit, out) {
      const o = osc('sine', 130, t, t + 0.42, decayGain(t, v * 0.8, 0.4, out));
      o.frequency.exponentialRampToValueAtTime(80, t + 0.35);
    },
    htom(t, v, kit, out) {
      const o = osc('sine', 210, t, t + 0.32, decayGain(t, v * 0.7, 0.3, out));
      o.frequency.exponentialRampToValueAtTime(140, t + 0.28);
    },
    ride(t, v, kit, out) {
      noiseSource(t, t + 0.8, filter('bandpass', 8500, 1.2, decayGain(t, v * 0.35, 0.75, out)));
      osc('square', 3150, t, t + 0.5, filter('highpass', 3000, 0, decayGain(t, v * 0.03, 0.45, out)));
    },
    crash(t, v, kit, out) {
      noiseSource(t, t + 1.6, filter('highpass', 4200, 0, decayGain(t, v * 0.42, 1.5, out)));
    },
    shaker(t, v, kit, out) {
      const g = audio.ctx.createGain();
      g.connect(out);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v * 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      noiseSource(t, t + 0.09, filter('bandpass', 6500, 1, g));
    },
    cowbell(t, v, kit, out) {
      const f = filter('bandpass', 750, 2, decayGain(t, v * 0.35, 0.3, out));
      osc('square', 545, t, t + 0.32, f);
      osc('square', 815, t, t + 0.32, f);
    },
  };

  // ---------------------------------------------------------------------
  // | Drum machine data                                                 |
  // ---------------------------------------------------------------------

  const DRUMS = [
    { id: 'kick', name: 'Kick', note: 36 },
    { id: 'snare', name: 'Snare', note: 38 },
    { id: 'clap', name: 'Clap', note: 39 },
    { id: 'rim', name: 'Rimshot', note: 37 },
    { id: 'chh', name: 'Closed hat', note: 42 },
    { id: 'ohh', name: 'Open hat', note: 46 },
    { id: 'ltom', name: 'Low tom', note: 45 },
    { id: 'htom', name: 'High tom', note: 50 },
    { id: 'ride', name: 'Ride', note: 51 },
    { id: 'crash', name: 'Crash', note: 49 },
    { id: 'shaker', name: 'Shaker', note: 70 },
    { id: 'cowbell', name: 'Cowbell', note: 56 },
  ];

  // Patterns are one bar of 4/4: `x` = accent, `o` = hit, `-` = off.
  // `steps` is the straight 16th grid; `trip` (optional) gives hand-written
  // 8th-note-triplet rows (12 steps), other rows are converted automatically.
  const PRESETS = {
    pop: {
      name: 'Pop', bpm: 110, kit: 'acoustic', swing: 0,
      steps: {
        kick: 'x-----o-x-------', snare: '----x-------x---', clap: '----o-------o---',
        chh: 'x-o-x-o-x-o-x-o-', crash: 'o---------------',
      },
    },
    rock: {
      name: 'Rock', bpm: 120, kit: 'acoustic', swing: 0,
      steps: {
        kick: 'x-------x-x-----', snare: '----x-------x---',
        chh: 'x-o-x-o-x-o-x-o-', crash: 'x---------------',
      },
    },
    boombap: {
      name: 'Hip-hop (boom bap)', bpm: 90, kit: 'acoustic', swing: 45,
      steps: {
        kick: 'x------o-ox-----', snare: '----x-------x---', rim: '-------o------o-',
        chh: 'x-o-x-o-x-o-x-oo', ohh: '--------------o-',
      },
    },
    trap: {
      name: 'Trap', bpm: 140, kit: 'k808', swing: 0,
      steps: {
        kick: 'x------x--x-----', snare: '--------x-------', clap: '--------x-------',
        chh: 'x-o-x-o-xooox-o-', ohh: '------------o---',
      },
      trip: { chh: 'xooxooxoxooo' },
    },
    house: {
      name: 'House', bpm: 124, kit: 'k909', swing: 10,
      steps: {
        kick: 'x---x---x---x---', clap: '----x-------x---', ohh: '--o---o---o---o-',
        chh: 'o-o-o-o-o-o-o-o-', shaker: 'oooooooooooooooo',
      },
    },
    techno: {
      name: 'Techno', bpm: 132, kit: 'k909', swing: 0,
      steps: {
        kick: 'x---x---x---x---', rim: '---o--o----o--o-', ohh: '--x---x---x---x-',
        chh: 'oooooooooooooooo', clap: '----o-------o---',
      },
    },
    dnb: {
      name: 'Drum & bass', bpm: 174, kit: 'acoustic', swing: 0,
      steps: {
        kick: 'x---------x-----', snare: '----x--o----x---', chh: 'o-o-o-o-o-o-o-o-',
        ride: '--o---o---o---o-',
      },
    },
    dubstep: {
      name: 'Dubstep', bpm: 140, kit: 'k808', swing: 0,
      steps: {
        kick: 'x---------o-----', snare: '--------x-------', chh: 'o-o-o-o-o-o-o-o-',
        ohh: '------o-------o-', crash: 'o---------------',
      },
    },
    reggae: {
      name: 'Reggae (one drop)', bpm: 76, kit: 'acoustic', swing: 35,
      steps: {
        kick: '--------x-------', rim: '--------x-------', chh: 'o-o-o-o-o-o-o-o-',
        ohh: '------o-------o-',
      },
    },
    reggaeton: {
      name: 'Reggaeton (dembow)', bpm: 95, kit: 'k808', swing: 0,
      steps: {
        kick: 'x---x---x---x---', snare: '---x--x----x--x-', chh: 'o-o-o-o-o-o-o-o-',
        shaker: '--o---o---o---o-',
      },
    },
    funk: {
      name: 'Funk', bpm: 102, kit: 'acoustic', swing: 15,
      steps: {
        kick: 'x-o---o---x--o--', snare: '----x--o-o--x--o', chh: 'xoxoxoxoxoxoxoxo',
        ohh: '--------------o-',
      },
    },
    disco: {
      name: 'Disco', bpm: 118, kit: 'acoustic', swing: 0,
      steps: {
        kick: 'x---x---x---x---', snare: '----x-------x---', ohh: '--o---o---o---o-',
        chh: 'o-o-o-o-o-o-o-o-', cowbell: '--o---o---o---o-',
      },
    },
    jazz: {
      name: 'Jazz swing', bpm: 140, kit: 'acoustic', swing: 70, triplet: true,
      steps: {
        ride: 'x---x-o-x---x-o-', chh: '----x-------x---', kick: 'o---o---o---o---',
        snare: '----------o-----',
      },
      trip: {
        ride: 'x--x-xx--x-x', chh: '---x-----x--', kick: 'o--o--o--o--', snare: '-------o----',
      },
    },
    shuffle: {
      name: 'Blues shuffle', bpm: 96, kit: 'acoustic', swing: 100, triplet: true,
      steps: {
        kick: 'x-------x-------', snare: '----x-------x---', chh: 'x-ox-ox-ox-ox-o-',
      },
      trip: { kick: 'x-----x-----', snare: '---x-----x--', chh: 'x-xx-xx-xx-x' },
    },
    lofi: {
      name: 'Lo-fi', bpm: 80, kit: 'lofi', swing: 55,
      steps: {
        kick: 'x------o--x-----', snare: '----x-------x---', chh: 'o-o-o-o-o-oo-o-o',
        rim: '-------------o--', shaker: '--o---o---o---o-',
      },
    },
    bossa: {
      name: 'Bossa nova', bpm: 132, kit: 'acoustic', swing: 0,
      steps: {
        kick: 'x--ox--ox--ox--o', rim: 'x--x--x---x--x--', chh: 'oooooooooooooooo',
      },
    },
    afrobeat: {
      name: 'Afrobeats', bpm: 108, kit: 'k808', swing: 20,
      steps: {
        kick: 'x--o--o-x--o--o-', snare: '----x--o----x---', rim: '---o--o----o--o-',
        shaker: 'oxooxooxoxooxoox', cowbell: 'x--x--x---x-x---',
      },
    },
  };

  const FEELS = { half: 2, normal: 1, double: 0.5 };
  const FEEL_NAMES = { half: 'Half time', normal: 'Normal time', double: 'Double time' };

  const drum = {
    preset: 'pop',
    bpm: 110,
    feel: 'normal',
    triplet: false,
    swing: 0,
    humanize: false,
    kit: 'acoustic',
    straight: {},
    trip: {},
    stale: { straight: false, trip: false },
    muted: new Set(),
  };

  const emptyRows = (n) => {
    const rows = {};
    DRUMS.forEach((d) => {
      rows[d.id] = new Array(n).fill(0);
    });
    return rows;
  };

  function parseRow(str, n) {
    const row = new Array(n).fill(0);
    for (let i = 0; i < n && i < str.length; i++) row[i] = str[i] === 'x' ? 2 : str[i] === 'o' ? 1 : 0;
    return row;
  }

  // Moves every hit to the nearest step of a grid with a different resolution.
  function convertRows(rows, from, to) {
    const out = emptyRows(to);
    DRUMS.forEach((d) => {
      rows[d.id].forEach((v, i) => {
        if (!v) return;
        const j = Math.round((i * to) / from) % to;
        out[d.id][j] = Math.max(out[d.id][j], v);
      });
    });
    return out;
  }

  const stepCount = () => (drum.triplet ? 12 : 16);
  const currentRows = () => (drum.triplet ? drum.trip : drum.straight);

  function loadPreset(key) {
    const p = PRESETS[key];
    drum.preset = key;
    drum.bpm = p.bpm;
    drum.kit = p.kit;
    drum.swing = p.swing;
    drum.straight = emptyRows(16);
    Object.keys(p.steps).forEach((id) => {
      drum.straight[id] = parseRow(p.steps[id], 16);
    });
    drum.trip = convertRows(drum.straight, 16, 12);
    if (p.trip) {
      Object.keys(p.trip).forEach((id) => {
        drum.trip[id] = parseRow(p.trip[id], 12);
      });
    }
    drum.stale = { straight: false, trip: false };
    drum.triplet = !!p.triplet;
  }

  function setTriplet(on) {
    if (on === drum.triplet) return;
    if (on && drum.stale.trip) {
      drum.trip = convertRows(drum.straight, 16, 12);
      drum.stale.trip = false;
    } else if (!on && drum.stale.straight) {
      drum.straight = convertRows(drum.trip, 12, 16);
      drum.stale.straight = false;
    }
    const before = stepCount();
    drum.triplet = on;
    dp.step = Math.floor((dp.step * stepCount()) / before) % stepCount();
  }

  function markEdited() {
    if (drum.triplet) drum.stale.straight = true;
    else drum.stale.trip = true;
  }

  // Length of one grid step in seconds.
  function drumStepDur(bpm) {
    return (60 / (bpm || drum.bpm)) * (drum.triplet ? 1 / 3 : 1 / 4) * FEELS[drum.feel];
  }

  // ---------------------------------------------------------------------
  // | Transport                                                         |
  // ---------------------------------------------------------------------

  const LOOKAHEAD = 0.12;
  let timer = null;
  let drawing = false;
  let melody = null;

  const mp = { playing: false, events: [], idx: 0, loopStart: 0, firstStart: 0, loopDur: 0, out: null };
  const dp = { playing: false, step: 0, nextTime: 0, out: null, queue: [], shown: -1 };

  function startTimer() {
    if (!timer) timer = setInterval(scheduleAll, 25);
    scheduleAll();
    if (!drawing) {
      drawing = true;
      requestAnimationFrame(draw);
    }
  }

  function stopTimerIfIdle() {
    if (!mp.playing && !dp.playing && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function scheduleAll() {
    if (!audio.ctx) return;
    const until = audio.ctx.currentTime + LOOKAHEAD;
    if (mp.playing) scheduleMelody(until);
    if (dp.playing) scheduleDrums(until);
  }

  // A fresh output node per run so Stop can silence ringing notes at once.
  function newOutput(bus) {
    const g = audio.ctx.createGain();
    g.connect(bus);
    return g;
  }

  function fadeOut(node) {
    if (!node) return;
    const t = audio.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(0, t + 0.06);
    setTimeout(() => node.disconnect(), 200);
  }

  function melodyEvents(m) {
    const spt = 60 / (m.bpm * TPQ);
    const events = m.notes.map((n) => {
      const start = swingTick(n.tick, m.swing) * spt;
      const end = swingTick(n.tick + n.dur, m.swing) * spt;
      return { type: 'note', time: start, dur: (end - start) * 0.92, midi: n.midi, vel: n.vel };
    });
    m.chords.forEach((c) => {
      events.push({ type: 'chord', time: c.bar * m.barTicks * spt, dur: m.barTicks * spt, chord: c });
    });
    events.sort((a, b) => a.time - b.time);
    return { events, loopDur: m.totalTicks * spt, barDur: m.barTicks * spt };
  }

  function startMelody(at) {
    if (!melody) return;
    initAudio();
    fadeOut(mp.out);
    const built = melodyEvents(melody);
    Object.assign(mp, built, { playing: true, idx: 0, loopStart: at, firstStart: at, out: newOutput(audio.melodyBus) });
    updatePlayButtons();
    startTimer();
  }

  function stopMelody() {
    mp.playing = false;
    if (audio.ctx) fadeOut(mp.out);
    mp.out = null;
    updatePlayButtons();
    stopTimerIfIdle();
  }

  function currentSound() {
    return $('m-sound').value || melody.sound;
  }

  function scheduleMelody(until) {
    while (mp.playing) {
      if (mp.idx >= mp.events.length) {
        if (!$('m-loop').checked) return;
        mp.loopStart += mp.loopDur;
        mp.idx = 0;
      }
      const ev = mp.events[mp.idx];
      const t = mp.loopStart + ev.time;
      if (t >= until) return;
      // Skip events the timer missed (e.g. while the phone screen was off).
      if (t < audio.ctx.currentTime - 0.05) {
        mp.idx++;
        continue;
      }
      if (ev.type === 'note') playTone(ev.midi, t, ev.dur, ev.vel, currentSound(), mp.out);
      else if ($('m-chords').checked) playChord(ev.chord, t, ev.dur, mp.out);
      mp.idx++;
    }
  }

  // Next melody bar line at or after `t` (to drop the drums in on the beat).
  function nextMelodyBar(t) {
    if (!mp.playing) return t;
    const k = Math.ceil((t - mp.firstStart) / mp.barDur - 1e-6);
    return mp.firstStart + Math.max(0, k) * mp.barDur;
  }

  // Next drum-loop downbeat at or after now (to drop a new melody in on the beat).
  function nextDrumDownbeat() {
    if (!dp.playing) return null;
    const steps = stepCount();
    return dp.step % steps === 0 ? dp.nextTime : dp.nextTime + (steps - (dp.step % steps)) * drumStepDur();
  }

  function startDrums(at) {
    initAudio();
    fadeOut(dp.out);
    Object.assign(dp, { playing: true, step: 0, nextTime: at, out: newOutput(audio.drumFilter), queue: [], shown: -1 });
    updatePlayButtons();
    startTimer();
  }

  function stopDrums() {
    dp.playing = false;
    if (audio.ctx) fadeOut(dp.out);
    dp.out = null;
    dp.queue = [];
    showStep(-1);
    updatePlayButtons();
    stopTimerIfIdle();
  }

  function triggerDrum(id, time, vel, out) {
    DRUM_SYNTHS[id](time, vel, KITS[drum.kit], out || audio.drumFilter);
  }

  function scheduleDrums(until) {
    // If the timer stalled (background tab, locked screen), rejoin the grid
    // now instead of firing every missed step at once.
    if (dp.nextTime < audio.ctx.currentTime - 0.1) dp.nextTime = audio.ctx.currentTime + 0.05;
    while (dp.nextTime < until) {
      const steps = stepCount();
      if (dp.step >= steps) dp.step = 0;
      const sd = drumStepDur();
      let t = dp.nextTime;
      if (!drum.triplet && dp.step % 2 === 1) t += (sd * drum.swing) / 300;
      const rows = currentRows();
      DRUMS.forEach((d) => {
        const v = rows[d.id][dp.step];
        if (!v || drum.muted.has(d.id)) return;
        let vel = v === 2 ? 1 : 0.6;
        let at = t;
        if (drum.humanize) {
          vel *= 0.88 + Math.random() * 0.2;
          at += (Math.random() - 0.5) * 0.016;
        }
        triggerDrum(d.id, Math.max(at, audio.ctx.currentTime), vel, dp.out);
      });
      dp.queue.push({ step: dp.step, time: t });
      dp.nextTime += sd;
      dp.step++;
    }
  }

  // ---------------------------------------------------------------------
  // | MIDI export                                                       |
  // ---------------------------------------------------------------------

  const MIDI_TPQ = 480;
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  function vlq(n) {
    const bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }

  function textEvent(type, text) {
    const bytes = Array.from(text).map((c) => c.charCodeAt(0) & 0x7f);
    return [0xff, type].concat(vlq(bytes.length), bytes);
  }

  // `events`: [{ tick, bytes, order }]; note-offs sort before note-ons.
  function trackChunk(events) {
    events.sort((a, b) => a.tick - b.tick || (a.order || 0) - (b.order || 0));
    let data = [];
    let last = 0;
    events.forEach((e) => {
      data = data.concat(vlq(e.tick - last), e.bytes);
      last = e.tick;
    });
    data = data.concat([0, 0xff, 0x2f, 0]);
    return [0x4d, 0x54, 0x72, 0x6b].concat(u32(data.length), data);
  }

  function midiFile(tracks) {
    let out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, MIDI_TPQ >> 8, MIDI_TPQ & 255];
    tracks.forEach((t) => {
      out = out.concat(trackChunk(t));
    });
    return new Uint8Array(out);
  }

  function noteEvents(channel, tick, dur, note, vel) {
    return [
      { tick, order: 1, bytes: [0x90 | channel, note, vel] },
      { tick: tick + Math.max(1, dur), order: 0, bytes: [0x80 | channel, note, 0] },
    ];
  }

  function tempoEvent(bpm) {
    const us = Math.round(60000000 / bpm);
    return { tick: 0, bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
  }

  // Key signature as sharps (+) / flats (-), indexed by relative-major pitch class.
  const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // A one-file zip archive (stored, no compression).
  function zipOne(name, data) {
    const nameBytes = Array.from(name).map((ch) => ch.charCodeAt(0) & 0x7f);
    const crc = crc32(data);
    const u16 = (n) => [n & 255, (n >>> 8) & 255];
    const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const common = [20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0].concat(le32(crc), le32(data.length), le32(data.length), u16(nameBytes.length));
    const local = [0x50, 0x4b, 3, 4].concat(common, [0, 0], nameBytes);
    const central = [0x50, 0x4b, 1, 2, 20, 0].concat(common, new Array(16).fill(0), nameBytes);
    const end = [0x50, 0x4b, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0].concat(le32(central.length), le32(local.length + data.length), [0, 0]);
    const out = new Uint8Array(local.length + data.length + central.length + end.length);
    out.set(local, 0);
    out.set(data, local.length);
    out.set(central, local.length + data.length);
    out.set(end, local.length + data.length + central.length);
    return out;
  }

  // Inside the claude.ai viewer, files go through its `downloads`
  // capability, which accepts .zip but not .mid, so the MIDI file is zipped.
  let viewerDownloads = null;

  function showSaveStatus(text) {
    document.querySelectorAll('.save-status').forEach((el) => {
      el.textContent = text;
    });
    clearTimeout(showSaveStatus.timer);
    showSaveStatus.timer = setTimeout(() => showSaveStatus(''), 6000);
  }

  function saveFile(bytes, name) {
    if (viewerDownloads) {
      const zipName = name.replace(/\.mid$/, '.zip');
      viewerDownloads.save({ filename: zipName, data: zipOne(name, bytes) }).then(() => {
        showSaveStatus(`Saved ${zipName}. Open it to get the MIDI file.`);
      }).catch((e) => {
        if (e && e.code === 'declined') return;
        if (e && e.code === 'rate_limited') showSaveStatus('A save is already waiting for you to confirm.');
        else showSaveStatus('Saving files isn\'t available here.');
      });
      return;
    }
    saveLocalFile(bytes, name);
  }

  // On phones, hand the file to the share sheet (Files, AirDrop, a DAW app);
  // elsewhere, or if sharing is unavailable, download it.
  function saveLocalFile(bytes, name) {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && typeof File === 'function' && navigator.canShare) {
      const file = new File([bytes], name, { type: 'audio/midi' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).catch((e) => {
          if (e.name !== 'AbortError') download(bytes, name);
        });
        return;
      }
    }
    download(bytes, name);
  }

  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fileName = (text) => text.toLowerCase().replace(/#/g, 's').replace(/[^a-z0-9.-]+/g, '-');

  // Conductor, melody and chord tracks for the generated melody.
  function melodyTracks(m) {
    const scale = SCALES[m.scale];
    const k = MIDI_TPQ / TPQ;
    const at = (t) => Math.round(swingTick(t, m.swing) * k);
    const sf = FIFTHS[mod(m.root + scale.rel, 12)];

    const conductor = [
      { tick: 0, bytes: textEvent(0x03, 'Melody & Drum Studio') },
      tempoEvent(m.bpm),
      { tick: 0, bytes: [0xff, 0x58, 0x04, m.num, Math.log2(m.den), 24, 8] },
      { tick: 0, bytes: [0xff, 0x59, 0x02, sf & 255, scale.minor ? 1 : 0] },
    ];

    let lead = [{ tick: 0, bytes: textEvent(0x03, 'Melody') }];
    m.notes.forEach((n) => {
      const start = at(n.tick);
      lead = lead.concat(noteEvents(0, start, Math.round((at(n.tick + n.dur) - start) * 0.95), n.midi, Math.round(n.vel * 110)));
    });

    let chords = [{ tick: 0, bytes: textEvent(0x03, 'Chords') }];
    m.chords.forEach((c) => {
      const start = c.bar * m.barTicks * k;
      const dur = m.barTicks * k - 10;
      c.pcs.forEach((pc) => {
        let note = 48 + pc;
        while (note < 48 + c.pcs[0]) note += 12;
        chords = chords.concat(noteEvents(1, start, dur, note, 70));
      });
      chords = chords.concat(noteEvents(1, start, dur, 36 + c.pcs[0], 85));
    });

    return { conductor, lead, chords, length: m.totalTicks * k };
  }

  // The drum pattern on channel 10, looped until `length` ticks
  // (by default about four bars of 4/4).
  function drumTrack(length) {
    const rows = currentRows();
    const steps = stepCount();
    const stepTicks = (drum.triplet ? MIDI_TPQ / 3 : MIDI_TPQ / 4) * FEELS[drum.feel];
    const loopTicks = steps * stepTicks;
    const end = length || Math.max(1, Math.round((MIDI_TPQ * 16) / loopTicks)) * loopTicks;
    let track = [{ tick: 0, bytes: textEvent(0x03, `Drums - ${PRESETS[drum.preset].name}`) }];
    for (let base = 0; base < end; base += loopTicks) {
      for (let s = 0; s < steps; s++) {
        let tick = base + s * stepTicks;
        if (tick >= end) break;
        if (!drum.triplet && s % 2 === 1) tick += (stepTicks * drum.swing) / 300;
        DRUMS.forEach((d) => {
          const v = rows[d.id][s];
          if (v && !drum.muted.has(d.id)) track = track.concat(noteEvents(9, Math.round(tick), 60, d.note, v === 2 ? 120 : 80));
        });
      }
    }
    return track;
  }

  function melodyName(m, suffix) {
    return fileName(`melody-${GENRES[m.genre].name}-${MOODS[m.mood].name}-${NOTE_NAMES[m.root]}-${m.scale}-${m.bpm}bpm${suffix}.mid`);
  }

  function exportMelody() {
    if (!melody) return;
    const t = melodyTracks(melody);
    saveFile(midiFile([t.conductor, t.lead, t.chords]), melodyName(melody, ''));
  }

  // Melody, chords and drums in one file, at the melody's tempo and length
  // (the same way Play all plays them together).
  function exportMelodyAndDrums() {
    if (!melody) return;
    const t = melodyTracks(melody);
    saveFile(midiFile([t.conductor, t.lead, t.chords, drumTrack(t.length)]), melodyName(melody, '-with-drums'));
  }

  function exportDrums() {
    const conductor = [tempoEvent(drum.bpm), { tick: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] }];
    const name = `drums-${PRESETS[drum.preset].name}-${drum.feel}${drum.triplet ? '-triplet' : ''}-${drum.bpm}bpm.mid`;
    saveFile(midiFile([conductor, drumTrack()]), fileName(name));
  }

  // ---------------------------------------------------------------------
  // | Piano roll                                                        |
  // ---------------------------------------------------------------------

  const roll = { canvas: null, ctx: null, cache: null, w: 0, h: 0, touchedAt: 0 };
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const CHORD_LANE = 22;

  // Narrow screens scroll the roll sideways instead of squashing the notes.
  const ROLL_PX_PER_QUARTER = 16;

  function sizeRoll() {
    const c = roll.canvas;
    const dpr = window.devicePixelRatio || 1;
    const minW = melody ? (melody.totalTicks / TPQ) * ROLL_PX_PER_QUARTER : 0;
    c.style.width = `${Math.max(c.parentElement.clientWidth, Math.ceil(minW))}px`;
    const rect = c.getBoundingClientRect();
    roll.w = rect.width;
    roll.h = rect.height;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    roll.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    roll.cache = null;
    drawRoll(null);
  }

  function rollLayout() {
    const m = melody;
    const pitches = m.notes.map((n) => n.midi);
    const minP = Math.min.apply(null, pitches) - 2;
    const maxP = Math.max.apply(null, pitches) + 2;
    return { minP, maxP, rowH: (roll.h - CHORD_LANE) / (maxP - minP + 1), xPerTick: roll.w / m.totalTicks };
  }

  function renderRollCache() {
    const off = document.createElement('canvas');
    off.width = roll.canvas.width;
    off.height = roll.canvas.height;
    const g = off.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = melody;
    const L = rollLayout();
    const y = (p) => CHORD_LANE + (L.maxP - p) * L.rowH;

    g.fillStyle = '#0d0f15';
    g.fillRect(0, 0, roll.w, roll.h);
    for (let p = L.minP; p <= L.maxP; p++) {
      if (BLACK.has(mod(p, 12))) {
        g.fillStyle = '#12151d';
        g.fillRect(0, y(p), roll.w, L.rowH);
      }
      if (mod(p, 12) === 0) {
        g.fillStyle = '#4a5068';
        g.font = '10px system-ui, sans-serif';
        g.fillText(`C${Math.floor(p / 12) - 1}`, 4, y(p) + L.rowH - 2);
      }
    }

    // Beat groups and bar lines
    const starts = groupStarts(m.groups);
    for (let b = 0; b < m.bars; b++) {
      starts.forEach((s, i) => {
        const x = Math.round((b * m.barTicks + s) * L.xPerTick) + 0.5;
        g.strokeStyle = i === 0 ? '#3a4158' : '#1d2130';
        g.beginPath();
        g.moveTo(x, i === 0 ? 0 : CHORD_LANE);
        g.lineTo(x, roll.h);
        g.stroke();
      });
    }

    // Chord lane
    g.fillStyle = '#141824';
    g.fillRect(0, 0, roll.w, CHORD_LANE);
    g.font = '600 11px system-ui, sans-serif';
    m.chords.forEach((c) => {
      const x = c.bar * m.barTicks * L.xPerTick;
      const w = m.barTicks * L.xPerTick;
      if (w > 28) {
        g.fillStyle = '#ffb547';
        g.fillText(c.name, x + 5, 15, w - 8);
      }
    });

    // Notes
    m.notes.forEach((n) => {
      const x = n.tick * L.xPerTick;
      const w = Math.max(2, n.dur * L.xPerTick - 1.5);
      const top = y(n.midi) + 1;
      const h = Math.max(2, L.rowH - 2);
      g.fillStyle = `rgba(157, 140, 255, ${0.55 + n.vel * 0.45})`;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, top, w, h, Math.min(3, h / 2));
      else g.rect(x, top, w, h);
      g.fill();
    });
    roll.cache = off;
  }

  function drawRoll(fraction) {
    const g = roll.ctx;
    if (!g) return;
    g.clearRect(0, 0, roll.w, roll.h);
    if (!melody) {
      g.fillStyle = '#0d0f15';
      g.fillRect(0, 0, roll.w, roll.h);
      g.fillStyle = '#5b627a';
      g.font = '14px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Your melody will appear here', roll.w / 2, roll.h / 2);
      g.textAlign = 'left';
      return;
    }
    if (!roll.cache) renderRollCache();
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(roll.cache, 0, 0);
    g.restore();
    if (fraction !== null) {
      const x = fraction * roll.w;
      g.fillStyle = 'rgba(255, 255, 255, 0.06)';
      g.fillRect(0, CHORD_LANE, x, roll.h - CHORD_LANE);
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(x), 0, 2, roll.h);
      followPlayhead(x);
    }
  }

  // Keeps the playhead visible when the roll scrolls, unless the user has
  // just scrolled it themselves.
  function followPlayhead(x) {
    const wrap = roll.canvas.parentElement;
    if (wrap.scrollWidth <= wrap.clientWidth || performance.now() - roll.touchedAt < 2500) return;
    if (x < wrap.scrollLeft + 16 || x > wrap.scrollLeft + wrap.clientWidth - 48) {
      wrap.scrollLeft = Math.max(0, x - 32);
    }
  }

  function draw() {
    const now = audio.ctx.currentTime;

    if (mp.playing) {
      const elapsed = now - mp.firstStart;
      if (elapsed < 0) {
        drawRoll(0);
      } else if (!$('m-loop').checked && now >= mp.loopStart + mp.loopDur && mp.idx >= mp.events.length) {
        stopMelody();
        drawRoll(null);
      } else {
        drawRoll((elapsed % mp.loopDur) / mp.loopDur);
      }
    }

    if (dp.playing) {
      let latest = null;
      while (dp.queue.length && dp.queue[0].time <= now) latest = dp.queue.shift();
      if (latest) showStep(latest.step);
    }

    if (mp.playing || dp.playing) {
      requestAnimationFrame(draw);
    } else {
      drawing = false;
      drawRoll(null);
    }
  }

  // ---------------------------------------------------------------------
  // | UI: melody                                                        |
  // ---------------------------------------------------------------------

  function fillSelect(select, entries, randomLabel) {
    const opts = randomLabel ? [['', randomLabel]].concat(entries) : entries;
    select.innerHTML = '';
    opts.forEach(([value, label]) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    });
  }

  function readMelodyInput() {
    const num = (id, min, max) => {
      const v = parseInt($(id).value, 10);
      return Number.isFinite(v) ? clamp(v, min, max) : '';
    };
    const den = $('m-ts-den').value;
    const root = $('m-key-root').value;
    return {
      genre: $('m-genre').value,
      mood: $('m-mood').value,
      bpm: num('m-bpm', 30, 300),
      tsNum: num('m-ts-num', 1, 16),
      tsDen: den ? Number(den) : '',
      root: root === '' ? '' : Number(root),
      scale: $('m-key-mode').value,
      length: $('m-length').value,
      rhythm: $('m-rhythm').value,
      sound: $('m-sound').value,
    };
  }

  function updateRandomBadges() {
    document.querySelectorAll('[data-random-field]').forEach((field) => {
      const inputs = field.querySelectorAll('input, select');
      field.classList.toggle('is-random', Array.from(inputs).some((el) => el.value === ''));
    });
  }

  function renderRolled() {
    const box = $('m-rolled');
    box.innerHTML = '';
    const m = melody;
    const r = m.rolled;
    const secs = Math.round((m.totalTicks * 60) / (m.bpm * TPQ));
    const chips = [
      ['Genre', GENRES[m.genre].name, r.genre],
      ['Mood', MOODS[m.mood].name, r.mood],
      ['BPM', m.bpm, r.bpm],
      ['Time', `${m.num}/${m.den}`, r.meter],
      ['Key', `${NOTE_NAMES[m.root]} ${SCALES[m.scale].name}`, r.root || r.scale],
      ['Length', `${m.bars} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, r.length],
      ['Rhythm', RHYTHMS[m.rhythm] + (m.swing ? ' (swung)' : ''), r.rhythm],
      ['Sound', SOUNDS[m.sound], r.sound],
      ['Chords', m.chords.slice(0, Math.min(4, m.chords.length)).map((c) => c.name).join(' – '), false],
    ];
    chips.forEach(([label, value, rolled]) => {
      const el = document.createElement('span');
      el.className = 'chip' + (rolled ? ' is-random' : '');
      const b = document.createElement('b');
      b.textContent = label;
      el.appendChild(b);
      el.appendChild(document.createTextNode(String(value)));
      box.appendChild(el);
    });
  }

  function generate() {
    melody = generateMelody(readMelodyInput());
    roll.canvas.parentElement.scrollLeft = 0;
    sizeRoll();
    renderRolled();
    $('m-play').disabled = false;
    $('m-export').disabled = false;
    $('m-export-all').disabled = false;
    roll.canvas.setAttribute('aria-label', `Piano roll: ${melody.notes.length} notes over ${melody.bars} bars, chords ${melody.chords.map((c) => c.name).join(', ')}`);

    if (mp.playing) {
      // Swap the new melody in on the next downbeat.
      const now = audio.ctx.currentTime + 0.05;
      const drumBeat = nextDrumDownbeat();
      startMelody(drumBeat !== null ? drumBeat : now);
    } else {
      drawRoll(null);
    }
  }

  function resetMelodyControls() {
    $('melody-form').reset();
    updateRandomBadges();
  }

  // ---------------------------------------------------------------------
  // | UI: drums                                                         |
  // ---------------------------------------------------------------------

  let stepEls = [];

  function renderGrid() {
    const grid = $('d-grid');
    const steps = stepCount();
    const groupSize = drum.triplet ? 3 : 4;
    const rows = currentRows();
    grid.innerHTML = '';
    grid.classList.toggle('triplet', drum.triplet);
    stepEls = Array.from({ length: steps }, () => []);

    const ruler = document.createElement('div');
    ruler.className = 'seq-row seq-ruler';
    ruler.setAttribute('aria-hidden', 'true');
    ruler.appendChild(document.createElement('span'));
    ruler.appendChild(document.createElement('span'));
    const rulerSteps = document.createElement('div');
    rulerSteps.className = 'seq-steps';
    for (let gi = 0; gi < steps / groupSize; gi++) {
      const group = document.createElement('div');
      group.className = 'seq-group';
      for (let s = 0; s < groupSize; s++) {
        const num = document.createElement('span');
        num.className = 'step-num';
        num.textContent = s === 0 ? String(gi + 1) : (drum.triplet ? ['', 'trip', 'let'][s] : ['', 'e', '&', 'a'][s]);
        group.appendChild(num);
      }
      rulerSteps.appendChild(group);
    }
    ruler.appendChild(rulerSteps);
    grid.appendChild(ruler);

    DRUMS.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'seq-row' + (drum.muted.has(d.id) ? ' is-muted' : '');

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'seq-name';
      name.textContent = d.name;
      name.title = `Hear ${d.name}`;
      name.addEventListener('click', () => {
        initAudio();
        triggerDrum(d.id, audio.ctx.currentTime + 0.01, 0.9);
      });

      const mute = document.createElement('button');
      mute.type = 'button';
      mute.className = 'seq-mute';
      mute.textContent = 'M';
      mute.setAttribute('aria-label', `Mute ${d.name}`);
      mute.setAttribute('aria-pressed', String(drum.muted.has(d.id)));
      mute.addEventListener('click', () => {
        if (drum.muted.has(d.id)) drum.muted.delete(d.id);
        else drum.muted.add(d.id);
        mute.setAttribute('aria-pressed', String(drum.muted.has(d.id)));
        row.classList.toggle('is-muted', drum.muted.has(d.id));
      });

      const stepsWrap = document.createElement('div');
      stepsWrap.className = 'seq-steps';
      let group = null;
      for (let s = 0; s < steps; s++) {
        if (s % groupSize === 0) {
          group = document.createElement('div');
          group.className = 'seq-group';
          stepsWrap.appendChild(group);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'step';
        btn.dataset.v = String(rows[d.id][s]);
        const label = () => `${d.name}, step ${s + 1}: ${['off', 'hit', 'accent'][rows[d.id][s]]}`;
        btn.setAttribute('aria-label', label());
        btn.addEventListener('click', () => {
          const r = currentRows();
          r[d.id][s] = (r[d.id][s] + 1) % 3;
          btn.dataset.v = String(r[d.id][s]);
          btn.setAttribute('aria-label', label());
          markEdited();
          if (r[d.id][s] && !dp.playing) {
            initAudio();
            triggerDrum(d.id, audio.ctx.currentTime + 0.01, r[d.id][s] === 2 ? 1 : 0.6);
          }
        });
        group.appendChild(btn);
        stepEls[s].push(btn);
      }

      row.appendChild(name);
      row.appendChild(mute);
      row.appendChild(stepsWrap);
      grid.appendChild(row);
    });
    dp.shown = -1;
  }

  function showStep(step) {
    if (step === dp.shown) return;
    if (dp.shown >= 0 && stepEls[dp.shown]) stepEls[dp.shown].forEach((el) => el.classList.remove('is-playing'));
    if (step >= 0 && stepEls[step]) stepEls[step].forEach((el) => el.classList.add('is-playing'));
    dp.shown = step;
  }

  function updateFeelInfo() {
    const perceived = Math.round(drum.bpm / FEELS[drum.feel]);
    const grid = drum.triplet ? '8th-note triplets (12 steps per cycle)' : '16th notes (16 steps per cycle)';
    const span = { half: 'two bars', normal: 'one bar', double: 'half a bar' }[drum.feel];
    $('d-feel-info').textContent = `${FEEL_NAMES[drum.feel]} · grid in ${grid} · one cycle = ${span} of 4/4 at ${drum.bpm} BPM` +
      (drum.feel === 'normal' ? '' : ` (feels like ${perceived} BPM)`);
  }

  function syncDrumControls() {
    $('d-preset').value = drum.preset;
    $('d-bpm').value = drum.bpm;
    $('d-bpm-range').value = drum.bpm;
    $('d-kit').value = drum.kit;
    $('d-swing').value = drum.swing;
    $('d-swing-out').textContent = `${drum.swing}%`;
    $('d-swing').disabled = drum.triplet;
    $('d-triplet').checked = drum.triplet;
    $('d-humanize').checked = drum.humanize;
    document.querySelectorAll('input[name="d-feel"]').forEach((r) => {
      r.checked = r.value === drum.feel;
    });
    if (audio.drumFilter) audio.drumFilter.frequency.value = KITS[drum.kit].filter;
    updateFeelInfo();
  }

  function setDrumBpm(v) {
    const bpm = clamp(Math.round(Number(v)) || drum.bpm, 40, 240);
    drum.bpm = bpm;
    $('d-bpm').value = bpm;
    $('d-bpm-range').value = bpm;
    updateFeelInfo();
  }

  function addVariation() {
    const rows = currentRows();
    const steps = stepCount();
    const off = (s) => s % (drum.triplet ? 3 : 4) !== 0;
    const tweak = (id, n, val) => {
      for (let i = 0; i < n; i++) {
        const s = randInt(0, steps - 1);
        if (off(s)) rows[id][s] = rows[id][s] ? 0 : val;
      }
    };
    tweak('chh', randInt(1, 3), 1);
    tweak('kick', randInt(0, 1), 1);
    tweak('snare', randInt(0, 2), 1);
    if (chance(0.4)) tweak('ohh', 1, 1);
    if (chance(0.3)) tweak(pick(['rim', 'shaker', 'htom', 'ltom']), randInt(1, 2), 1);
    markEdited();
    renderGrid();
  }

  function updatePlayButtons() {
    const mBtn = $('m-play');
    mBtn.textContent = mp.playing ? 'Stop' : 'Play';
    mBtn.classList.toggle('is-active', mp.playing);
    const dBtn = $('d-play');
    dBtn.textContent = dp.playing ? 'Stop' : 'Play';
    dBtn.classList.toggle('is-active', dp.playing);
    const all = mp.playing && dp.playing;
    $('play-all').textContent = all ? 'Restart all' : 'Play all';
    const active = mp.playing || dp.playing;
    setMediaSession(active);
    setWakeLock(active);
  }

  // Keeps a phone screen awake while music is playing.
  let wakeLock = null;

  function setWakeLock(on) {
    if (!('wakeLock' in navigator)) return;
    if (on && !wakeLock) {
      wakeLock = 'pending';
      navigator.wakeLock.request('screen').then((lock) => {
        wakeLock = lock;
        lock.addEventListener('release', () => {
          if (wakeLock === lock) wakeLock = null;
        });
        if (!mp.playing && !dp.playing) setWakeLock(false);
      }).catch(() => {
        wakeLock = null;
      });
    } else if (!on && wakeLock && wakeLock !== 'pending') {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // ---------------------------------------------------------------------
  // | Wiring                                                            |
  // ---------------------------------------------------------------------

  function init() {
    fillSelect($('m-genre'), Object.keys(GENRES).map((k) => [k, GENRES[k].name]), 'Random');
    fillSelect($('m-mood'), Object.keys(MOODS).map((k) => [k, MOODS[k].name]), 'Random');
    fillSelect($('m-key-root'), NOTE_NAMES.map((n, i) => [String(i), n]), 'Random root');
    fillSelect($('m-key-mode'), Object.keys(SCALES).map((k) => [k, SCALES[k].name]), 'Random scale');
    fillSelect($('m-rhythm'), Object.keys(RHYTHMS).map((k) => [k, RHYTHMS[k]]), 'Random');
    fillSelect($('m-sound'), Object.keys(SOUNDS).map((k) => [k, SOUNDS[k]]), 'Auto (from genre)');
    fillSelect($('d-preset'), Object.keys(PRESETS).map((k) => [k, PRESETS[k].name]));
    fillSelect($('d-kit'), Object.keys(KITS).map((k) => [k, KITS[k].name]));

    roll.canvas = $('m-roll');
    roll.ctx = roll.canvas.getContext('2d');
    ['touchstart', 'wheel', 'pointerdown'].forEach((type) => {
      roll.canvas.parentElement.addEventListener(type, () => {
        roll.touchedAt = performance.now();
      }, { passive: true });
    });

    // Phones suspend or interrupt audio when the screen locks or a call
    // comes in; pick back up when the page is visible again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (mp.playing || dp.playing) {
        resumeAudio();
        setMediaSession(true);
        setWakeLock(true);
      }
    });
    sizeRoll();
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sizeRoll, 100);
    });

    // Melody
    const form = $('melody-form');
    form.addEventListener('input', updateRandomBadges);
    form.addEventListener('change', updateRandomBadges);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      generate();
    });
    updateRandomBadges();

    $('m-generate').addEventListener('click', () => {
      initAudio();
      generate();
    });
    $('m-play').addEventListener('click', () => {
      if (mp.playing) {
        stopMelody();
        drawRoll(null);
        return;
      }
      initAudio();
      const at = nextDrumDownbeat();
      startMelody(at !== null ? at : audio.ctx.currentTime + 0.06);
    });
    $('m-reset').addEventListener('click', resetMelodyControls);
    $('m-export').addEventListener('click', exportMelody);
    $('m-export-all').addEventListener('click', exportMelodyAndDrums);
    $('m-volume').addEventListener('input', (e) => {
      if (audio.melodyBus) audio.melodyBus.gain.value = Number(e.target.value);
    });

    // Drums
    loadPreset(drum.preset);
    syncDrumControls();
    renderGrid();

    $('d-preset').addEventListener('change', (e) => {
      loadPreset(e.target.value);
      dp.step = 0;
      syncDrumControls();
      renderGrid();
    });
    $('d-bpm').addEventListener('change', (e) => setDrumBpm(e.target.value));
    $('d-bpm-range').addEventListener('input', (e) => setDrumBpm(e.target.value));
    $('d-kit').addEventListener('change', (e) => {
      drum.kit = e.target.value;
      syncDrumControls();
    });
    $('d-swing').addEventListener('input', (e) => {
      drum.swing = Number(e.target.value);
      $('d-swing-out').textContent = `${drum.swing}%`;
    });
    document.querySelectorAll('input[name="d-feel"]').forEach((r) => {
      r.addEventListener('change', () => {
        drum.feel = r.value;
        updateFeelInfo();
      });
    });
    $('d-triplet').addEventListener('change', (e) => {
      setTriplet(e.target.checked);
      syncDrumControls();
      renderGrid();
    });
    $('d-humanize').addEventListener('change', (e) => {
      drum.humanize = e.target.checked;
    });
    $('d-play').addEventListener('click', () => {
      if (dp.playing) {
        stopDrums();
        return;
      }
      initAudio();
      startDrums(nextMelodyBar(audio.ctx.currentTime + 0.06));
    });
    $('d-sync').addEventListener('click', () => {
      if (melody) setDrumBpm(melody.bpm);
    });
    $('d-vary').addEventListener('click', addVariation);
    $('d-clear').addEventListener('click', () => {
      if (drum.triplet) drum.trip = emptyRows(12);
      else drum.straight = emptyRows(16);
      markEdited();
      renderGrid();
    });
    $('d-export').addEventListener('click', exportDrums);
    $('d-volume').addEventListener('input', (e) => {
      if (audio.drumBus) audio.drumBus.gain.value = Number(e.target.value);
    });

    // In the claude.ai viewer, plain downloads are blocked: hide the export
    // buttons until its downloads capability answers.
    if (window.claude && typeof window.claude.use === 'function') {
      const exportButtons = ['m-export', 'm-export-all', 'd-export'].map($);
      exportButtons.forEach((b) => {
        b.hidden = true;
      });
      window.claude.use('downloads').then((d) => {
        viewerDownloads = d;
        if (d) {
          exportButtons.forEach((b) => {
            b.hidden = false;
          });
        }
      }).catch(() => {});
    }

    // Global transport
    $('master-volume').addEventListener('input', (e) => {
      if (audio.master) audio.master.gain.value = Number(e.target.value);
    });
    $('play-all').addEventListener('click', () => {
      initAudio();
      if (!melody) generate();
      setDrumBpm(melody.bpm);
      const at = audio.ctx.currentTime + 0.1;
      startMelody(at);
      startDrums(at);
    });
    $('stop-all').addEventListener('click', () => {
      stopMelody();
      stopDrums();
      drawRoll(null);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
