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

  // Each instrument shapes the melody as well as the sound: `range` is a
  // comfortable playing range (MIDI notes), `leap` scales jump sizes,
  // `rest` adds breathing room, `gate` is how much of each note sounds
  // (1 = legato), `rhythms` biases Random rhythm picks, and `program` is
  // the General MIDI instrument used in exported files.
  const INSTRUMENTS = {
    piano: {
      name: 'Piano', range: [48, 84], synth: 'piano', program: 0, leap: 1.1, rest: 0, gate: 0.9,
      desc: 'Wide range and any rhythm.',
    },
    epiano: {
      name: 'Electric piano', range: [48, 79], synth: 'keys', program: 4, leap: 1, rest: 0.02, gate: 0.9,
      desc: 'Mellow keys with laid-back, syncopated phrasing.',
      rhythms: [['syncopated', 2], ['sparse', 2], ['swing', 1]],
    },
    guitar: {
      name: 'Acoustic guitar', range: [52, 81], synth: 'pluck', program: 25, leap: 1, rest: 0, gate: 0.8,
      desc: 'Picked notes and broken chords.',
      rhythms: [['arpeggio', 3], ['straight', 2], ['syncopated', 2], ['tresillo', 2]],
    },
    eguitar: {
      name: 'Electric guitar', range: [52, 86], synth: 'eguitar', program: 29, leap: 1.1, rest: 0.03, gate: 0.85,
      desc: 'Driven tone and punchy, riff-like rhythms.',
      rhythms: [['syncopated', 3], ['straight', 2], ['dotted', 2], ['dense', 1]],
    },
    bass: {
      name: 'Bass', range: [28, 55], synth: 'bass', program: 33, leap: 0.9, rest: 0.05, gate: 0.85,
      desc: 'Low register, grooving around the chord roots.',
      rhythms: [['syncopated', 3], ['straight', 3], ['sparse', 2], ['offbeat', 1]],
    },
    violin: {
      name: 'Violin', range: [55, 88], synth: 'violin', program: 40, leap: 1.2, rest: 0.02, gate: 1,
      desc: 'Singing, legato lines with vibrato.',
      rhythms: [['sparse', 2], ['straight', 2], ['dotted', 2], ['triplet', 1]],
    },
    cello: {
      name: 'Cello', range: [36, 67], synth: 'cello', program: 42, leap: 0.9, rest: 0.03, gate: 1,
      desc: 'Warm, low and sustained.',
      rhythms: [['sparse', 3], ['straight', 2], ['dotted', 1]],
    },
    flute: {
      name: 'Flute', range: [60, 93], synth: 'flute', program: 73, leap: 1.1, rest: 0.08, gate: 0.95,
      desc: 'Airy and agile, with room to breathe.',
      rhythms: [['straight', 2], ['triplet', 2], ['sparse', 2], ['dense', 1]],
    },
    sax: {
      name: 'Saxophone', range: [49, 81], synth: 'sax', program: 65, leap: 1.2, rest: 0.08, gate: 0.95,
      desc: 'Reedy and expressive: swung, syncopated lines with breaths.',
      rhythms: [['swing', 3], ['syncopated', 3], ['dotted', 1], ['triplet', 1]],
    },
    trumpet: {
      name: 'Trumpet', range: [55, 82], synth: 'trumpet', program: 56, leap: 0.9, rest: 0.1, gate: 0.85,
      desc: 'Bright and bold, in short phrases with breaths.',
      rhythms: [['syncopated', 3], ['straight', 2], ['dotted', 2], ['offbeat', 1]],
    },
    marimba: {
      name: 'Marimba', range: [48, 84], synth: 'marimba', program: 12, leap: 1, rest: 0, gate: 0.6,
      desc: 'Woody mallets playing busy, rhythmic patterns.',
      rhythms: [['dense', 3], ['arpeggio', 3], ['tresillo', 2], ['straight', 1]],
    },
    synth: {
      name: 'Synth lead', range: [55, 86], synth: 'lead', program: 81, leap: 1, rest: 0, gate: 0.9,
      desc: 'Cuts through a mix; any rhythm.',
    },
    pad: {
      name: 'Synth pad', range: [48, 76], synth: 'pad', program: 89, leap: 0.8, rest: 0.05, gate: 1,
      desc: 'Slow swells and long held notes.',
      rhythms: [['sparse', 5], ['straight', 1]],
    },
    bells: {
      name: 'Bells', range: [67, 96], synth: 'bell', program: 10, leap: 1.1, rest: 0.03, gate: 0.9,
      desc: 'Glassy, high and ringing.',
      rhythms: [['arpeggio', 2], ['sparse', 2], ['triplet', 1]],
    },
  };

  const noteLabel = (midi) => NOTE_NAMES[mod(midi, 12)] + (Math.floor(midi / 12) - 1);
  const rangeLabel = (inst) => `${noteLabel(inst.range[0])}–${noteLabel(inst.range[1])}`;

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
      instruments: [['piano', 3], ['guitar', 2], ['synth', 2], ['epiano', 1], ['bells', 1]],
      leap: 0.25, rest: 0.08,
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
      instruments: [['eguitar', 5], ['synth', 1], ['piano', 1]],
      leap: 0.3, rest: 0.08,
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
      instruments: [['sax', 4], ['piano', 3], ['trumpet', 3], ['epiano', 2], ['flute', 1], ['bass', 1]],
      leap: 0.45, rest: 0.1, sevenths: true, swing: { unit: 24, ratio: 0.66 },
    },
    blues: {
      name: 'Blues', bpm: [70, 120],
      scales: [['blues', 5], ['minorPentatonic', 3], ['mixolydian', 1]],
      rhythms: [['swing', 4], ['triplet', 4], ['dotted', 1]],
      meters: [['4/4', 8], ['12/8', 4]],
      prog: { major: [[0, 3, 0, 0], [0, 3, 0, 4], [4, 3, 0, 4]] },
      instruments: [['eguitar', 3], ['sax', 2], ['piano', 2], ['trumpet', 1]],
      leap: 0.3, rest: 0.15, sevenths: true, swing: { unit: 24, ratio: 0.66 },
    },
    funk: {
      name: 'Funk', bpm: [92, 115],
      scales: [['dorian', 4], ['mixolydian', 3], ['minorPentatonic', 3]],
      rhythms: [['syncopated', 6], ['dense', 2], ['offbeat', 2]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 3, 0, 3], [0, 0, 3, 3]], minor: [[0, 3, 0, 3], [0, 6, 3, 0]] },
      instruments: [['bass', 3], ['eguitar', 2], ['epiano', 2], ['sax', 1], ['synth', 1]],
      leap: 0.3, rest: 0.18, sevenths: true, swing: { unit: 12, ratio: 0.56 },
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
      instruments: [['epiano', 3], ['piano', 2], ['bells', 2], ['flute', 1], ['bass', 1]],
      leap: 0.25, rest: 0.2, sevenths: true, swing: { unit: 12, ratio: 0.58 },
    },
    trap: {
      name: 'Trap', bpm: [130, 160],
      scales: [['minor', 4], ['harmonicMinor', 3], ['phrygian', 2]],
      rhythms: [['triplet', 3], ['sparse', 3], ['syncopated', 2], ['arpeggio', 2]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 5, 3, 4]], minor: [[0, 5, 4, 0], [0, 5, 2, 4], [0, 0, 5, 6]] },
      instruments: [['bells', 4], ['flute', 2], ['synth', 2], ['piano', 1]],
      leap: 0.3, rest: 0.25,
    },
    lofi: {
      name: 'Lo-fi', bpm: [70, 90],
      scales: [['major', 2], ['dorian', 3], ['minor', 2], ['majorPentatonic', 2]],
      rhythms: [['sparse', 3], ['syncopated', 3], ['swing', 2], ['dotted', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[3, 2, 1, 0], [1, 4, 0, 5], [3, 4, 2, 5]], minor: [[0, 3, 6, 2], [1, 4, 0, 0]] },
      instruments: [['epiano', 4], ['guitar', 2], ['piano', 2], ['bells', 1]],
      leap: 0.3, rest: 0.2, sevenths: true, swing: { unit: 12, ratio: 0.6 },
    },
    edm: {
      name: 'EDM / House', bpm: [118, 130],
      scales: [['minor', 5], ['major', 3], ['minorPentatonic', 2]],
      rhythms: [['offbeat', 3], ['syncopated', 3], ['arpeggio', 3], ['dense', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[5, 3, 0, 4], [0, 4, 5, 3]], minor: [[0, 5, 2, 6], [5, 3, 0, 4], [0, 6, 5, 6]] },
      instruments: [['synth', 5], ['pad', 1], ['bells', 1], ['piano', 1]],
      leap: 0.25, rest: 0.1,
    },
    reggae: {
      name: 'Reggae', bpm: [70, 90],
      scales: [['major', 4], ['minor', 2], ['mixolydian', 1], ['majorPentatonic', 2]],
      rhythms: [['offbeat', 5], ['syncopated', 2], ['dotted', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 3, 0, 4], [0, 3, 4, 3], [0, 5, 3, 4]], minor: [[0, 3, 0, 3], [0, 6, 5, 6]] },
      instruments: [['epiano', 2], ['guitar', 2], ['bass', 2], ['trumpet', 1], ['sax', 1]],
      leap: 0.25, rest: 0.15, swing: { unit: 12, ratio: 0.58 },
    },
    latin: {
      name: 'Latin', bpm: [90, 130],
      scales: [['minor', 3], ['harmonicMinor', 2], ['major', 3], ['phrygian', 1]],
      rhythms: [['tresillo', 6], ['syncopated', 3]],
      meters: [['4/4', 8], ['6/8', 2]],
      prog: { major: [[0, 4, 4, 0], [0, 3, 4, 0]], minor: [[0, 3, 4, 0], [0, 6, 5, 4]] },
      instruments: [['guitar', 4], ['trumpet', 2], ['marimba', 2], ['flute', 1], ['piano', 1]],
      leap: 0.3, rest: 0.1,
    },
    classical: {
      name: 'Classical', bpm: [60, 132],
      scales: [['major', 4], ['minor', 2], ['harmonicMinor', 3]],
      rhythms: [['straight', 3], ['dotted', 2], ['arpeggio', 2], ['triplet', 1]],
      meters: [['4/4', 6], ['3/4', 5], ['2/4', 2], ['6/8', 2]],
      prog: { major: [[0, 3, 4, 0], [0, 5, 1, 4], [0, 1, 4, 0]], minor: [[0, 3, 4, 0], [0, 5, 3, 4]] },
      instruments: [['piano', 4], ['violin', 4], ['cello', 2], ['flute', 2]],
      leap: 0.35, rest: 0.05,
    },
    ambient: {
      name: 'Ambient', bpm: [60, 90],
      scales: [['lydian', 3], ['major', 2], ['majorPentatonic', 3], ['dorian', 2]],
      rhythms: [['sparse', 8], ['straight', 1]],
      meters: [['4/4', 5], ['3/4', 2], ['6/8', 2], ['5/4', 1]],
      prog: { major: [[0, 3, 0, 3], [0, 5, 3, 0]], minor: [[0, 5, 3, 6]] },
      instruments: [['pad', 4], ['bells', 2], ['piano', 1], ['flute', 1]],
      leap: 0.4, rest: 0.25, sevenths: true,
    },
    prog: {
      name: 'Prog / Math rock', bpm: [100, 150],
      scales: [['minor', 3], ['dorian', 2], ['lydian', 2], ['phrygian', 1]],
      rhythms: [['syncopated', 3], ['dense', 2], ['straight', 2], ['dotted', 1]],
      meters: [['7/8', 4], ['5/4', 3], ['7/4', 2], ['9/8', 1], ['11/8', 1], ['5/8', 1]],
      prog: { major: [[0, 1, 4, 5]], minor: [[0, 5, 6, 0], [0, 3, 5, 6]] },
      instruments: [['eguitar', 3], ['synth', 3], ['bass', 1], ['piano', 1]],
      leap: 0.4, rest: 0.1,
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
      instruments: ['marimba', 'guitar', 'bells', 'flute'],
    },
    sad: {
      name: 'Sad', tempo: 0.8, leap: 0.8, rest: 0.06, register: -5,
      scales: [['minor', 5], ['harmonicMinor', 2], ['dorian', 1], ['minorPentatonic', 1]],
      rhythms: [['sparse', 4], ['straight', 2], ['dotted', 2]],
      instruments: ['piano', 'cello', 'violin'],
    },
    dark: {
      name: 'Dark', tempo: 0.9, leap: 1, rest: 0.05, register: -12,
      scales: [['phrygian', 4], ['harmonicMinor', 3], ['minor', 2]],
      rhythms: [['sparse', 3], ['syncopated', 2], ['triplet', 2]],
      instruments: ['cello', 'synth', 'bass'],
    },
    dreamy: {
      name: 'Dreamy', tempo: 0.85, leap: 1.3, rest: 0.04, register: 5,
      scales: [['lydian', 5], ['majorPentatonic', 3], ['major', 1], ['dorian', 1]],
      rhythms: [['sparse', 3], ['arpeggio', 3], ['triplet', 2]],
      instruments: ['pad', 'bells', 'epiano'],
    },
    calm: {
      name: 'Calm', tempo: 0.85, leap: 0.7, rest: 0.05, register: 0,
      scales: [['majorPentatonic', 5], ['major', 2], ['dorian', 1]],
      rhythms: [['sparse', 4], ['straight', 3]],
      instruments: ['piano', 'guitar', 'flute'],
    },
    energetic: {
      name: 'Energetic', tempo: 1.15, leap: 1.1, rest: -0.05, register: 5,
      scales: [['minor', 2], ['major', 2], ['minorPentatonic', 2], ['mixolydian', 1]],
      rhythms: [['dense', 3], ['syncopated', 3], ['offbeat', 2], ['arpeggio', 2]],
      instruments: ['synth', 'eguitar', 'trumpet'],
    },
    tense: {
      name: 'Tense', tempo: 1.05, leap: 1.4, rest: 0, register: 0,
      scales: [['harmonicMinor', 4], ['phrygian', 3], ['minor', 1]],
      rhythms: [['syncopated', 3], ['dense', 2], ['triplet', 2]],
      instruments: ['violin', 'cello', 'synth'],
    },
    mysterious: {
      name: 'Mysterious', tempo: 0.9, leap: 1.2, rest: 0.05, register: 0,
      scales: [['dorian', 3], ['phrygian', 2], ['harmonicMinor', 2], ['lydian', 1]],
      rhythms: [['triplet', 3], ['sparse', 3], ['syncopated', 2]],
      instruments: ['bells', 'flute', 'cello'],
    },
    romantic: {
      name: 'Romantic', tempo: 0.9, leap: 1.1, rest: 0.02, register: 0,
      scales: [['major', 3], ['minor', 2], ['harmonicMinor', 2]],
      rhythms: [['dotted', 3], ['triplet', 2], ['straight', 2]],
      instruments: ['violin', 'piano', 'sax'],
    },
    epic: {
      name: 'Epic', tempo: 1, leap: 1.3, rest: 0, register: 5,
      scales: [['minor', 4], ['harmonicMinor', 2], ['dorian', 1]],
      rhythms: [['dotted', 3], ['straight', 2], ['triplet', 2]],
      instruments: ['trumpet', 'violin', 'cello'],
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

  // Random picks for a half-set time signature. Common meters are the most
  // likely, but odd and long ones come up too.
  function numeratorFor(den) {
    if (den === 1) return pick([1, 2, 3, 4]);
    if (den === 2) return weighted([[2, 4], [3, 3], [4, 2], [5, 1], [6, 1]]);
    if (den === 4) return weighted([[4, 8], [3, 3], [2, 1], [5, 1], [6, 1], [7, 1], [9, 0.5], [11, 0.5]]);
    if (den === 8) return weighted([[6, 5], [12, 2], [9, 2], [7, 2], [5, 2], [3, 1], [11, 1], [13, 0.5], [15, 0.5]]);
    if (den === 16) return weighted([[7, 1], [9, 1], [11, 1], [5, 1], [12, 1], [13, 1], [15, 1], [17, 0.5]]);
    return weighted([[12, 1], [16, 1], [24, 1], [15, 1], [21, 1]]);
  }

  function denominatorFor(num) {
    if (num % 3 === 0 && num > 3) return weighted([[8, 4], [4, 1], [16, 1]]);
    if (num % 2 === 1 && num > 3) return weighted([[8, 3], [4, 2], [16, 1]]);
    if (num === 2) return weighted([[4, 3], [2, 2]]);
    if (num > 16) return weighted([[8, 2], [16, 2], [4, 1]]);
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
      // Mostly the genre's usual meters, sometimes anything at all.
      if (chance(0.12)) {
        den = weighted([[4, 3], [8, 3], [16, 1], [2, 1]]);
        num = numeratorFor(den);
      } else {
        [num, den] = weighted(g.meters).split('/').map(Number);
      }
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
    // The instrument picker sets the lead in Melody and Ensemble modes and
    // the chord instrument in Chord progression mode. Every role is
    // resolved either way, so switching modes later can reuse the song.
    const mode = input.mode || 'melody';
    const leadPick = () => weighted(blendWeights(g.instruments, md.instruments.map((k) => [k, 3])));
    let instrument;
    let chordInstrument;
    if (mode === 'chords') {
      chordInstrument = roll('instrument', input.instrument, () => pickChordInstrument(g, md));
      instrument = leadPick();
    } else {
      instrument = roll('instrument', input.instrument, leadPick);
      chordInstrument = input.chordInstrument || pickChordInstrument(g, md, instrument);
    }
    const bassInstrument = input.bassInstrument || (genre === 'classical' ? 'cello' : 'bass');
    const inst = INSTRUMENTS[mode === 'chords' ? chordInstrument : instrument];
    const rhythm = roll('rhythm', input.rhythm, () => {
      const base = blendWeights(g.rhythms, md.rhythms);
      return weighted(inst.rhythms ? blendWeights(base, inst.rhythms) : base);
    });

    return { mode, genre, mood, bpm, num, den, root, scale, length, rhythm, instrument, chordInstrument, bassInstrument, rolled };
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

    // Fit the melody into the instrument's range. The mood nudges it up or
    // down; the tonic sits about a fifth below the target so the melody's
    // middle lands there.
    const md = MOODS[s.mood];
    const inst = INSTRUMENTS[s.instrument];
    const [low, high] = inst.range;
    const target = clamp((low + high) / 2 + md.register * 0.6, low + 6, high - 6);
    const tonicMidi = s.root + 12 * Math.round((target - 7 - s.root) / 12);
    const toMidi = (idx) => tonicMidi + 12 * Math.floor(idx / n) + steps[mod(idx, n)];
    let lo = -Math.ceil(n * 0.43);
    let hi = n + Math.ceil(n * 0.72);
    while (toMidi(lo) < low) lo++;
    while (toMidi(hi) > high) hi--;
    while (hi - lo < Math.round(n * 1.5) && toMidi(hi + 1) <= high) hi++;
    while (hi - lo < Math.round(n * 1.5) && toMidi(lo - 1) >= low) lo--;
    let center = lo;
    for (let i = lo; i <= hi; i++) {
      if (Math.abs(toMidi(i) - target) < Math.abs(toMidi(center) - target)) center = i;
    }
    const ctx = {
      root: s.root,
      steps,
      n,
      lo,
      hi,
      center,
      span: Math.max(1, (hi - lo) / 2),
      tonicMidi,
      leap: g.leap * md.leap * inst.leap,
      pattern: s.rhythm,
      restProb: s.rhythm === 'arpeggio' ? 0 : clamp(g.rest * (s.rhythm === 'sparse' ? 1.4 : 1) + md.rest + inst.rest, 0, 0.5),
      arpUnit: pick([12, 24, 24]),
      groups,
      barTicks,
      strongSet: new Set(groupStarts(groups)),
    };

    const harmony = scaleHarmony(s.scale);
    const progs = scale.modal ? MODAL_PROGS[s.scale] : (scale.minor ? g.prog.minor || g.prog.major : g.prog.major);
    const prog = pick(progs);
    const plan = phrasePlan(bars);

    const startDegree = pick([0, 2, n > 5 ? 4 : 3]);
    const state = { prev: nearestIdx(ctx, ctx.center, (i) => mod(i, n) === startDegree), lastMove: 0, dir: 1 };
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

    const m = Object.assign(s, {
      notes,
      chords,
      groups,
      barTicks,
      bars,
      totalTicks: bars * barTicks,
      swing: resolveSwing(s, groups),
      sevenths: !!g.sevenths,
    });
    buildParts(m);
    return m;
  }

  // ---------------------------------------------------------------------
  // | Arrangement: chord and bass parts                                 |
  // ---------------------------------------------------------------------

  // Instruments that can play a chord at once. Single-note instruments
  // play the chords as broken chords instead.
  const POLY = new Set(['piano', 'epiano', 'guitar', 'eguitar', 'marimba', 'synth', 'pad', 'bells']);

  // How the rhythmic pattern setting translates to chord comping and bass.
  const COMP_STYLE = {
    straight: 'straight', syncopated: 'syncopated', dotted: 'dotted', swing: 'swing', triplet: 'triplet',
    sparse: 'sparse', dense: 'straight', arpeggio: 'arpeggio', offbeat: 'offbeat', tresillo: 'tresillo',
  };
  const BASS_STYLE = {
    straight: 'straight', syncopated: 'syncopated', dotted: 'dotted', swing: 'walking', triplet: 'straight',
    sparse: 'sparse', dense: 'straight', arpeggio: 'straight', offbeat: 'syncopated', tresillo: 'tresillo',
  };

  function pickChordInstrument(g, md, avoid) {
    const entries = blendWeights(g.instruments, md.instruments.map((k) => [k, 3]))
      .filter(([k]) => POLY.has(k) && k !== avoid);
    return entries.length ? weighted(entries) : 'piano';
  }

  // Comping and bass rhythms are rolled once per song so the groove stays
  // put when instruments or modes change.
  function ensureGroove(m) {
    if (m.groove) return;
    const strongSet = new Set(groupStarts(m.groups));
    const bar = (pattern, keepDownbeat) => {
      const ctx = { groups: m.groups, barTicks: m.barTicks, strongSet, pattern, restProb: 0.04, arpUnit: 24 };
      const items = makeBarRhythm(ctx);
      if (keepDownbeat) items[0].rest = false;
      return items;
    };
    const comp = COMP_STYLE[m.rhythm] === 'arpeggio' ? 'straight' : COMP_STYLE[m.rhythm];
    const compA = bar(comp, comp !== 'offbeat');
    const bassStyle = BASS_STYLE[m.rhythm] === 'walking' ? 'straight' : BASS_STYLE[m.rhythm];
    const bassA = bar(bassStyle, true);
    const tripletOk = m.groups.every((len) => len === 48);
    m.groove = {
      compA,
      compB: chance(0.5) ? compA : ensureNote(varyRhythm(compA)),
      bassA,
      bassB: chance(0.5) ? bassA : varyRhythm(bassA),
      arpUnit: m.rhythm === 'dense' ? 12 : (m.rhythm === 'triplet' && tripletOk ? 16 : 24),
    };
    m.groove.compB[0].rest = comp === 'offbeat';
    m.groove.bassB[0].rest = false;
  }

  // Picks the inversion and octave closest to the previous chord, inside
  // the instrument's chord range.
  function voiceChord(pcs, prev, lo, hi) {
    let best = null;
    let bestScore = Infinity;
    for (let inv = 0; inv < pcs.length; inv++) {
      const order = pcs.slice(inv).concat(pcs.slice(0, inv));
      for (let octave = 0; octave < 2; octave++) {
        const notes = [lo + mod(order[0] - lo, 12) + octave * 12];
        for (let i = 1; i < order.length; i++) {
          let n = notes[i - 1] + 1;
          while (mod(n, 12) !== order[i]) n++;
          notes.push(n);
        }
        if (notes[notes.length - 1] > hi && best) continue;
        const score = prev ?
          notes.reduce((sum, n, i) => sum + Math.abs(n - prev[Math.min(i, prev.length - 1)]), 0) :
          Math.abs(notes.reduce((a, b) => a + b, 0) / notes.length - (lo + hi) / 2);
        if (score < bestScore || (best && best[best.length - 1] > hi)) {
          best = notes;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function chordPart(m) {
    ensureGroove(m);
    const key = m.chordInstrument;
    const [ilo, ihi] = INSTRUMENTS[key].range;
    const lo = clamp(50, ilo, ihi - 16);
    const hi = Math.min(ihi, Math.max(lo + 17, 79));
    const strong = new Set(groupStarts(m.groups));
    const broken = !POLY.has(key) || COMP_STYLE[m.rhythm] === 'arpeggio';
    const notes = [];
    let prev = null;
    m.chords.forEach((c, bar) => {
      const voicing = voiceChord(c.pcs, prev, lo, hi);
      prev = voicing;
      const base = bar * m.barTicks;
      const last = bar === m.chords.length - 1;
      if (broken && !(last && POLY.has(key))) {
        const top = voicing[0] + 12 <= ihi ? [voicing[0] + 12] : [];
        const up = voicing.concat(top);
        const cycle = up.concat(up.slice(1, -1).reverse());
        const unit = m.groove.arpUnit;
        for (let t = 0, i = 0; t < m.barTicks; t += unit, i++) {
          const dur = last && t + unit >= m.barTicks ? m.barTicks - t : Math.min(unit, m.barTicks - t);
          notes.push({ tick: base + t, dur, midi: cycle[i % cycle.length], vel: strong.has(t) ? 0.82 : 0.64 });
        }
        return;
      }
      const rhythm = last ? [{ start: 0, dur: m.barTicks, rest: false }] : (bar % 2 ? m.groove.compB : m.groove.compA);
      rhythm.forEach((it) => {
        if (it.rest) return;
        voicing.forEach((midi) => {
          notes.push({ tick: base + it.start, dur: it.dur, midi, vel: strong.has(it.start) ? 0.74 : 0.62 });
        });
      });
    });
    return notes;
  }

  function bassPart(m) {
    ensureGroove(m);
    const [low, high] = INSTRUMENTS[m.bassInstrument].range;
    const style = BASS_STYLE[m.rhythm];
    const strong = new Set(groupStarts(m.groups));
    const rootOf = (pc) => {
      let n = low + mod(pc - low, 12);
      if (n < low + 4) n += 12;
      return n;
    };
    const fit = (n) => {
      while (n > high) n -= 12;
      while (n < low) n += 12;
      return n;
    };
    const notes = [];
    m.chords.forEach((c, bar) => {
      const base = bar * m.barTicks;
      const root = rootOf(c.pcs[0]);
      const third = root + mod(c.pcs[1] - c.pcs[0], 12);
      const fifth = root + mod(c.pcs[2] - c.pcs[0], 12);
      const next = m.chords[bar + 1];
      const nextRoot = next ? rootOf(next.pcs[0]) : null;
      let rhythm;
      if (!next) {
        rhythm = [{ start: 0, dur: m.barTicks, rest: false }];
      } else if (style === 'walking') {
        rhythm = [];
        let pos = 0;
        m.groups.forEach((len) => {
          const step = len % 48 === 0 ? 48 : len;
          for (let t = 0; t < len; t += step) rhythm.push({ start: pos + t, dur: step, rest: false });
          pos += len;
        });
      } else {
        rhythm = bar % 2 ? m.groove.bassB : m.groove.bassA;
      }
      const played = rhythm.filter((it) => !it.rest);
      played.forEach((it, i) => {
        let midi;
        if (it.start === 0) midi = root;
        else if (i === played.length - 1 && nextRoot !== null && nextRoot !== root && chance(style === 'walking' ? 0.8 : 0.35)) midi = nextRoot + (nextRoot > root ? -1 : 1);
        else if (style === 'walking') midi = pick([third, fifth, root + 12]);
        else midi = strong.has(it.start) ? pick([fifth, root, root + 12]) : pick([root, root, fifth]);
        notes.push({ tick: base + it.start, dur: it.dur, midi: fit(midi), vel: it.start === 0 ? 0.9 : 0.74 });
      });
    });
    return notes;
  }

  // The parts that play (and export) in the song's current mode.
  function buildParts(m) {
    m.parts = [];
    if (m.mode !== 'chords') m.parts.push({ role: 'lead', instrument: m.instrument, notes: m.notes });
    if (m.mode !== 'melody') {
      m.parts.push({ role: 'chords', instrument: m.chordInstrument, notes: chordPart(m) });
      m.parts.push({ role: 'bass', instrument: m.bassInstrument, notes: bassPart(m) });
    }
  }

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  // Roman numeral relative to the major scale on the same tonic (so a
  // flat seventh chord in Mixolydian reads bVII).
  function romanNumeral(m, c) {
    const d = mod(c.deg, 7);
    const diff = scaleHarmony(m.scale)[d] - MAJOR_STEPS[d];
    const third = mod(c.pcs[1] - c.pcs[0], 12);
    const fifth = mod(c.pcs[2] - c.pcs[0], 12);
    let numeral = third === 3 ? ROMAN[d].toLowerCase() : ROMAN[d];
    if (fifth === 6) numeral += c.pcs.length > 3 && mod(c.pcs[3] - c.pcs[0], 12) === 10 ? 'ø' : '°';
    else if (fifth === 8) numeral += '+';
    if (c.pcs.length > 3 && fifth !== 6) numeral += mod(c.pcs[3] - c.pcs[0], 12) === 11 ? 'maj7' : '7';
    return (diff < 0 ? 'b' : diff > 0 ? '#' : '') + numeral;
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

  // Pitch wobble that fades in after `delay` seconds (strings, winds).
  function vibrato(oscs, f, time, end, cents, rate, delay) {
    const lfo = audio.ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = audio.ctx.createGain();
    depth.gain.setValueAtTime(0, time);
    depth.gain.linearRampToValueAtTime(f * (Math.pow(2, cents / 1200) - 1), time + delay);
    lfo.connect(depth);
    oscs.forEach((o) => depth.connect(o.frequency));
    lfo.start(time);
    lfo.stop(end);
  }

  function driveCurve() {
    if (!audio.drive) {
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 3);
      }
      audio.drive = curve;
    }
    return audio.drive;
  }

  function lowpass(freq, q, dest) {
    const f = audio.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    f.connect(dest);
    return f;
  }

  function playTone(midi, time, dur, vel, sound, dest) {
    const ctx = audio.ctx;
    const f = mtof(midi);
    const amp = ctx.createGain();
    amp.connect(dest);
    let end;

    if (sound === 'piano') {
      const filt = lowpass(Math.min(f * 12, 14000), 0, amp);
      filt.frequency.setValueAtTime(Math.min(f * 12, 14000), time);
      filt.frequency.exponentialRampToValueAtTime(Math.min(f * 3, 8000), time + 0.8);
      end = envelope(amp.gain, time, dur, 0.3 * vel, 0.003, 1.8, 0.02, 0.25);
      osc('triangle', f, time, end, filt);
      const partials = ctx.createGain();
      partials.connect(filt);
      partials.gain.setValueAtTime(0.35, time);
      partials.gain.exponentialRampToValueAtTime(0.01, time + 0.6);
      osc('sine', f * 2, time, end, partials, 3);
      osc('sine', f * 3, time, end, partials, -4);
    } else if (sound === 'eguitar') {
      const filt = lowpass(2800, 1, amp);
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve();
      shaper.connect(filt);
      const pre = ctx.createGain();
      pre.gain.value = 0.6;
      pre.connect(shaper);
      end = envelope(amp.gain, time, dur, 0.1 * vel, 0.005, 0.3, 0.6, 0.15);
      osc('sawtooth', f, time, end, pre);
      osc('square', f * 1.003, time, end, pre);
    } else if (sound === 'bass') {
      const filt = lowpass(Math.min(f * 6, 1200), 2, amp);
      filt.frequency.setValueAtTime(Math.min(f * 8, 1600), time);
      filt.frequency.exponentialRampToValueAtTime(Math.min(f * 3, 700), time + 0.25);
      end = envelope(amp.gain, time, dur, 0.38 * vel, 0.005, 0.3, 0.6, 0.08);
      osc('sine', f, time, end, amp);
      osc('sawtooth', f, time, end, filt);
    } else if (sound === 'violin' || sound === 'cello') {
      const cello = sound === 'cello';
      const filt = lowpass(cello ? 2000 : 3800, 1, amp);
      end = envelope(amp.gain, time, dur, (cello ? 0.16 : 0.12) * vel, cello ? 0.1 : 0.08, 0.2, 0.85, 0.2);
      const a = osc('sawtooth', f, time, end, filt, -4);
      const b = osc('sawtooth', f, time, end, filt, 5);
      vibrato([a, b], f, time, end, cello ? 10 : 12, cello ? 5 : 5.6, 0.25);
    } else if (sound === 'flute') {
      end = envelope(amp.gain, time, dur, 0.2 * vel, 0.06, 0.1, 0.9, 0.12);
      const a = osc('sine', f, time, end, amp);
      const soft = ctx.createGain();
      soft.gain.value = 0.25;
      soft.connect(amp);
      const b = osc('triangle', f, time, end, soft);
      vibrato([a, b], f, time, end, 8, 5, 0.2);
      noiseSource(time, end, filter('bandpass', f * 2, 2, decayGain(time, 0.05 * vel, Math.max(0.15, dur), amp)));
    } else if (sound === 'sax') {
      const filt = lowpass(f * 2, 3, amp);
      filt.frequency.setValueAtTime(f * 2, time);
      filt.frequency.linearRampToValueAtTime(Math.min(f * 5, 6000), time + 0.08);
      end = envelope(amp.gain, time, dur, 0.12 * vel, 0.03, 0.15, 0.8, 0.1);
      const a = osc('square', f, time, end, filt);
      const b = osc('sawtooth', f, time, end, filt, 6);
      vibrato([a, b], f, time, end, 10, 5, 0.3);
    } else if (sound === 'trumpet') {
      const filt = lowpass(f * 1.5, 2, amp);
      filt.frequency.setValueAtTime(f * 1.5, time);
      filt.frequency.exponentialRampToValueAtTime(Math.min(f * 7, 9000), time + 0.07);
      filt.frequency.exponentialRampToValueAtTime(Math.min(f * 4, 7000), time + 0.3);
      end = envelope(amp.gain, time, dur, 0.12 * vel, 0.025, 0.15, 0.8, 0.08);
      const a = osc('sawtooth', f, time, end, filt);
      const b = osc('sawtooth', f, time, end, filt, 7);
      vibrato([a, b], f, time, end, 6, 5.5, 0.3);
    } else if (sound === 'marimba') {
      end = envelope(amp.gain, time, dur, 0.4 * vel, 0.002, 0.6, 0.001, 0.1);
      osc('sine', f, time, end, amp);
      osc('sine', f * 4, time, time + 0.12, decayGain(time, 0.25 * vel, 0.08, dest));
    } else if (sound === 'lead') {
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

  function playChord(chord, time, dur, dest, withBass) {
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
    // Bass (left out when the melody itself is on bass)
    if (!withBass) return;
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

  // Chord parts stack several voices, so each sounds softer.
  const ROLE_LEVEL = { lead: 1, chords: 0.55, bass: 0.9 };

  function melodyEvents(m) {
    const spt = 60 / (m.bpm * TPQ);
    const events = [];
    m.parts.forEach((part) => {
      const inst = INSTRUMENTS[part.instrument];
      part.notes.forEach((n) => {
        const start = swingTick(n.tick, m.swing) * spt;
        const end = swingTick(n.tick + n.dur, m.swing) * spt;
        events.push({
          type: 'note', role: part.role, synth: inst.synth, time: start,
          dur: (end - start) * inst.gate * 0.97, midi: n.midi, vel: n.vel * ROLE_LEVEL[part.role],
        });
      });
    });
    // Melody mode keeps its simple backing chords (toggled by the switch).
    if (m.mode === 'melody') {
      m.chords.forEach((c) => {
        events.push({ type: 'chord', time: c.bar * m.barTicks * spt, dur: m.barTicks * spt, chord: c });
      });
    }
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
      // In Chord progression mode the switch turns the bass line on or off.
      if (ev.type === 'note') {
        if (!(ev.role === 'bass' && melody.mode === 'chords' && !$('m-chords').checked)) playTone(ev.midi, t, ev.dur, ev.vel, ev.synth, mp.out);
      }
      else if ($('m-chords').checked) playChord(ev.chord, t, ev.dur, mp.out, melody.instrument !== 'bass');
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

    const ROLE_NAMES = { lead: 'Melody', chords: 'Chords', bass: 'Bass' };
    const CHANNELS = { lead: 0, chords: 1, bass: 2 };
    const tracks = m.parts.map((part) => {
      const inst = INSTRUMENTS[part.instrument];
      const ch = CHANNELS[part.role];
      let track = [
        { tick: 0, bytes: textEvent(0x03, `${ROLE_NAMES[part.role]} - ${inst.name}`) },
        { tick: 0, bytes: [0xc0 | ch, inst.program] },
      ];
      part.notes.forEach((n) => {
        const start = at(n.tick);
        const vel = Math.round(n.vel * (part.role === 'chords' ? 90 : 110));
        track = track.concat(noteEvents(ch, start, Math.max(1, Math.round((at(n.tick + n.dur) - start) * inst.gate * 0.97)), n.midi, vel));
      });
      return track;
    });

    // Melody mode exports its backing chords too.
    if (m.mode === 'melody') {
      let chords = [{ tick: 0, bytes: textEvent(0x03, 'Backing chords') }];
      m.chords.forEach((c) => {
        const start = c.bar * m.barTicks * k;
        const dur = m.barTicks * k - 10;
        c.pcs.forEach((pc) => {
          let note = 48 + pc;
          while (note < 48 + c.pcs[0]) note += 12;
          chords = chords.concat(noteEvents(1, start, dur, note, 70));
        });
        if (m.instrument !== 'bass') chords = chords.concat(noteEvents(1, start, dur, 36 + c.pcs[0], 85));
      });
      tracks.push(chords);
    }

    return { conductor, tracks, length: m.totalTicks * k };
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
    const main = m.mode === 'chords' ? m.chordInstrument : m.instrument;
    const prefix = { melody: 'melody', chords: 'chords', ensemble: 'ensemble' }[m.mode];
    return fileName(`${prefix}-${GENRES[m.genre].name}-${INSTRUMENTS[main].name}-${MOODS[m.mood].name}-${NOTE_NAMES[m.root]}-${m.scale}-${m.bpm}bpm${suffix}.mid`);
  }

  function exportMelody() {
    if (!melody) return;
    const t = melodyTracks(melody);
    saveFile(midiFile([t.conductor].concat(t.tracks)), melodyName(melody, ''));
  }

  // Melody, chords and drums in one file, at the melody's tempo and length
  // (the same way Play all plays them together).
  function exportMelodyAndDrums() {
    if (!melody) return;
    const t = melodyTracks(melody);
    saveFile(midiFile([t.conductor].concat(t.tracks, [drumTrack(t.length)])), melodyName(melody, '-with-drums'));
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
  const ROLE_COLORS = { lead: '157, 140, 255', chords: '62, 207, 178', bass: '90, 169, 255' };

  // Narrow screens scroll the roll sideways instead of squashing the notes.
  // Very long songs (huge bars) get fewer pixels per beat so the canvas
  // stays under browser size limits.
  const ROLL_PX_PER_QUARTER = 16;
  const ROLL_MAX_WIDTH = 16000;

  function sizeRoll() {
    const c = roll.canvas;
    const minW = melody ? Math.min(ROLL_MAX_WIDTH, (melody.totalTicks / TPQ) * ROLL_PX_PER_QUARTER) : 0;
    c.style.width = `${Math.max(c.parentElement.clientWidth, Math.ceil(minW))}px`;
    const rect = c.getBoundingClientRect();
    // Stay inside canvas limits (iOS Safari allows about 16 million pixels).
    const dpr = Math.max(0.25, Math.min(window.devicePixelRatio || 1, 32000 / Math.max(1, rect.width), Math.sqrt(16e6 / Math.max(1, rect.width * rect.height))));
    roll.dpr = dpr;
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
    const pitches = [];
    m.parts.forEach((part) => part.notes.forEach((n) => pitches.push(n.midi)));
    const minP = Math.min.apply(null, pitches) - 2;
    const maxP = Math.max.apply(null, pitches) + 2;
    return { minP, maxP, rowH: (roll.h - CHORD_LANE) / (maxP - minP + 1), xPerTick: roll.w / m.totalTicks };
  }

  function renderRollCache() {
    const off = document.createElement('canvas');
    off.width = roll.canvas.width;
    off.height = roll.canvas.height;
    const g = off.getContext('2d');
    const dpr = roll.dpr || 1;
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

    // Notes, lead drawn last so it stays on top
    const order = { chords: 0, bass: 1, lead: 2 };
    m.parts.slice().sort((a, b) => order[a.role] - order[b.role]).forEach((part) => {
      const rgb = ROLE_COLORS[part.role];
      part.notes.forEach((n) => {
        const x = n.tick * L.xPerTick;
        const w = Math.max(2, n.dur * L.xPerTick - 1.5);
        const top = y(n.midi) + 1;
        const h = Math.max(2, L.rowH - 2);
        g.fillStyle = `rgba(${rgb}, ${0.55 + n.vel * 0.45})`;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, top, w, h, Math.min(3, h / 2));
        else g.rect(x, top, w, h);
        g.fill();
      });
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
      // 255 is the most a MIDI file can store for beats per bar.
      tsNum: num('m-ts-num', 1, 255),
      tsDen: den ? Number(den) : '',
      root: root === '' ? '' : Number(root),
      scale: $('m-key-mode').value,
      length: $('m-length').value,
      rhythm: $('m-rhythm').value,
      instrument: fieldValue('m-instrument'),
      mode: genMode,
      chordInstrument: genMode === 'ensemble' ? $('m-ens-chords').value : '',
      bassInstrument: genMode === 'ensemble' ? $('m-ens-bass').value : '',
    };
  }

  // Generator mode, and the instrument picker's value remembered per mode
  // (it means the lead in Melody/Ensemble and the chords in Chord progression).
  let genMode = 'melody';
  const pickerByMode = { melody: '', chords: '', ensemble: '' };

  // The instrument picker is a radio group; these let the rest of the form
  // code treat it like a single field.
  function fieldValue(id) {
    if (id !== 'm-instrument') return $(id).value;
    const checked = document.querySelector('input[name="instrument"]:checked');
    return checked ? checked.value : '';
  }

  function setFieldValue(id, value) {
    if (id !== 'm-instrument') {
      $(id).value = value;
      return;
    }
    document.querySelectorAll('input[name="instrument"]').forEach((r) => {
      r.checked = r.value === value;
    });
    updateInstrumentInfo();
  }

  function buildInstrumentPicker() {
    const box = $('m-instrument');
    const entries = [['', 'Random', 'fits genre & mood']]
      .concat(Object.keys(INSTRUMENTS).map((k) => [k, INSTRUMENTS[k].name, rangeLabel(INSTRUMENTS[k])]));
    entries.forEach(([value, name, sub]) => {
      const label = document.createElement('label');
      label.className = 'inst';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'instrument';
      input.value = value;
      input.defaultChecked = value === '';
      input.checked = value === '';
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = name;
      const small = document.createElement('small');
      small.textContent = sub;
      span.appendChild(strong);
      span.appendChild(small);
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });
    updateInstrumentInfo();
  }

  function updateInstrumentInfo() {
    const key = fieldValue('m-instrument');
    const inst = INSTRUMENTS[key];
    $('m-inst-info').textContent = inst ?
      `${inst.name} · ${rangeLabel(inst)} · ${inst.desc}` :
      'Random picks an instrument that suits the genre and mood. Every instrument gets melodies written for its range and style.';
  }

  // Re-plays the current song after its parts changed, swapping in on the
  // next downbeat if it is playing.
  function refreshSong() {
    buildParts(melody);
    sizeRoll();
    renderRolled();
    renderLegend();
    if (mp.playing) {
      const drumBeat = nextDrumDownbeat();
      startMelody(drumBeat !== null ? drumBeat : nextMelodyBar(audio.ctx.currentTime + 0.05));
    }
  }

  // Picking an instrument after generating applies it to the current song.
  // For the lead, the melody moves into the new range (whole octaves,
  // folding any stray notes); chords are re-voiced for the new instrument.
  // Generate writes a new song in the instrument's style.
  function onInstrumentPicked(key) {
    if (!melody || !INSTRUMENTS[key]) return;
    if (genMode === 'chords') {
      if (key === melody.chordInstrument) return;
      melody.chordInstrument = key;
      refreshSong();
      return;
    }
    if (key === melody.instrument) return;
    const [low, high] = INSTRUMENTS[key].range;
    let best = 0;
    let bestScore = Infinity;
    for (let k = -4; k <= 4; k++) {
      const outside = melody.notes.filter((n) => n.midi + 12 * k < low || n.midi + 12 * k > high).length;
      const mid = melody.notes.reduce((sum, n) => sum + n.midi + 12 * k, 0) / melody.notes.length;
      const score = outside * 100 + Math.abs(mid - (low + high) / 2);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    melody.notes.forEach((n) => {
      let m = n.midi + 12 * best;
      while (m < low) m += 12;
      while (m > high) m -= 12;
      n.midi = m;
    });
    melody.instrument = key;
    refreshSong();
  }

  function onEnsemblePartPicked() {
    if (!melody) return;
    const chordKey = $('m-ens-chords').value;
    const bassKey = $('m-ens-bass').value;
    if (chordKey) melody.chordInstrument = chordKey;
    if (bassKey) melody.bassInstrument = bassKey;
    if (chordKey || bassKey) refreshSong();
  }

  const MODE_TEXT = {
    melody: { legend: 'Instrument', backing: 'Backing chords', download: 'melody' },
    chords: { legend: 'Chord instrument', backing: 'Bass line', download: 'chords' },
    ensemble: { legend: 'Lead instrument', backing: '', download: 'ensemble' },
  };

  function applyModeUi() {
    const text = MODE_TEXT[genMode];
    $('m-inst-legend').textContent = text.legend;
    $('m-chords-label').textContent = text.backing;
    $('m-chords').closest('.switch').hidden = !text.backing;
    document.querySelectorAll('.ens-only').forEach((el) => {
      el.hidden = genMode !== 'ensemble';
    });
    $('m-export').textContent = `Download ${text.download} MIDI`;
    $('m-export-all').textContent = `Download ${text.download} + drums MIDI`;
    $('m-roll').classList.toggle('is-tall', genMode !== 'melody');
    updateInstrumentInfo();
  }

  // Switching modes keeps the current song: the same chords and melody are
  // re-arranged for the new mode.
  function setMode(mode) {
    if (mode === genMode) return;
    pickerByMode[genMode] = fieldValue('m-instrument');
    genMode = mode;
    setFieldValue('m-instrument', pickerByMode[mode]);
    applyModeUi();
    updateRandomBadges();
    if (melody) {
      melody.mode = mode;
      refreshSong();
    }
  }

  function renderLegend() {
    const box = $('m-legend');
    box.innerHTML = '';
    if (!melody || melody.parts.length < 2) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const names = { lead: 'Lead', chords: 'Chords', bass: 'Bass' };
    melody.parts.forEach((part) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('i');
      dot.style.background = `rgb(${ROLE_COLORS[part.role]})`;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(`${names[part.role]} · ${INSTRUMENTS[part.instrument].name}`));
      box.appendChild(item);
    });
  }

  function updateRandomBadges() {
    document.querySelectorAll('[data-random-field]').forEach((field) => {
      const inputs = field.querySelectorAll('input, select');
      field.classList.toggle('is-random', Array.from(inputs).some((el) => (el.type === 'radio' ? el.checked && el.value === '' : el.value === '')));
    });
  }

  // Each result chip is a lock. Locking writes the rolled value into the
  // form (so the next Generate keeps it); unlocking sets it back to Random.
  const LOCK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"></rect><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg>';
  const UNLOCK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"></rect><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"></path></svg>';

  function lockableSettings(m) {
    const secs = Math.round((m.totalTicks * 60) / (m.bpm * TPQ));
    return [
      { label: 'Genre', value: GENRES[m.genre].name, fields: { 'm-genre': m.genre } },
      { label: 'Mood', value: MOODS[m.mood].name, fields: { 'm-mood': m.mood } },
      { label: 'BPM', value: m.bpm, fields: { 'm-bpm': m.bpm } },
      { label: 'Time', value: `${m.num}/${m.den}`, fields: { 'm-ts-num': m.num, 'm-ts-den': m.den } },
      { label: 'Key', value: NOTE_NAMES[m.root], fields: { 'm-key-root': m.root } },
      { label: 'Scale', value: SCALES[m.scale].name, fields: { 'm-key-mode': m.scale } },
      { label: 'Length', value: `${m.bars} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, fields: { 'm-length': m.length } },
      { label: 'Rhythm', value: RHYTHMS[m.rhythm] + (m.swing ? ' (swung)' : ''), fields: { 'm-rhythm': m.rhythm } },
      m.mode === 'chords' ?
        { label: 'Chord instrument', value: INSTRUMENTS[m.chordInstrument].name, fields: { 'm-instrument': m.chordInstrument } } :
        { label: m.mode === 'ensemble' ? 'Lead' : 'Instrument', value: INSTRUMENTS[m.instrument].name, fields: { 'm-instrument': m.instrument } },
    ];
  }

  function renderRolled() {
    const box = $('m-rolled');
    if (!melody) return;
    box.innerHTML = '';
    lockableSettings(melody).forEach((setting) => {
      const ids = Object.keys(setting.fields);
      const locked = ids.every((id) => fieldValue(id) !== '');
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'chip chip-lock' + (locked ? ' is-locked' : ' is-random');
      el.setAttribute('aria-pressed', String(locked));
      el.title = locked ? `Unlock ${setting.label} so Generate re-rolls it` : `Lock ${setting.label} at ${setting.value}`;
      el.innerHTML = locked ? LOCK_ICON : UNLOCK_ICON;
      const b = document.createElement('b');
      b.textContent = setting.label;
      el.appendChild(b);
      el.appendChild(document.createTextNode(String(setting.value)));
      el.addEventListener('click', () => {
        ids.forEach((id) => {
          setFieldValue(id, locked ? '' : String(setting.fields[id]));
        });
        updateRandomBadges();
        renderRolled();
        const again = Array.from(box.children).find((c) => c.querySelector('b').textContent === setting.label);
        if (again) again.focus();
      });
      box.appendChild(el);
    });

    const info = (label, text) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const b = document.createElement('b');
      b.textContent = label;
      chip.appendChild(b);
      chip.appendChild(document.createTextNode(text));
      box.appendChild(chip);
    };
    const firstBars = melody.chords.slice(0, Math.min(4, melody.chords.length));
    if (melody.mode !== 'melody') info('Progression', firstBars.map((c) => romanNumeral(melody, c)).join(' – '));
    info('Chords', firstBars.map((c) => c.name).join(' – '));
    if (melody.mode === 'ensemble') {
      info('Chords on', INSTRUMENTS[melody.chordInstrument].name);
      info('Bass on', INSTRUMENTS[melody.bassInstrument].name);
    } else if (melody.mode === 'chords') {
      info('Bass on', INSTRUMENTS[melody.bassInstrument].name);
    }
    $('m-lock-hint').hidden = false;
  }

  function generate() {
    melody = generateMelody(readMelodyInput());
    roll.canvas.parentElement.scrollLeft = 0;
    sizeRoll();
    renderRolled();
    renderLegend();
    $('m-play').disabled = false;
    $('m-export').disabled = false;
    $('m-export-all').disabled = false;
    roll.canvas.setAttribute('aria-label', `Piano roll: ${melody.parts.map((p) => p.role).join(', ')} over ${melody.bars} bars, chords ${melody.chords.map((c) => c.name).join(', ')}`);

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
    updateInstrumentInfo();
    updateRandomBadges();
    renderRolled();
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
    buildInstrumentPicker();
    fillSelect($('m-ens-chords'), Object.keys(INSTRUMENTS).map((k) => [k, INSTRUMENTS[k].name]), 'Auto (from genre)');
    fillSelect($('m-ens-bass'), [['bass', 'Bass'], ['cello', 'Cello'], ['synth', 'Synth lead'], ['pad', 'Synth pad'], ['piano', 'Piano']], 'Auto (from genre)');
    document.querySelectorAll('input[name="m-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => setMode(radio.value));
    });
    applyModeUi();
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
    form.addEventListener('change', (e) => {
      if (e.target.name === 'instrument') {
        updateInstrumentInfo();
        onInstrumentPicked(e.target.value);
      } else if (e.target.id === 'm-ens-chords' || e.target.id === 'm-ens-bass') {
        onEnsemblePartPicked();
      }
      updateRandomBadges();
      renderRolled();
    });
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
