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

  // Inside the VST3/AU plugin the page runs in the plugin window's web view.
  // JUCE injects `window.__JUCE__`; sound and timing then come from the
  // plugin (synced to the DAW), not from Web Audio.
  const juceBackend = window.__JUCE__ && window.__JUCE__.backend;
  const IN_PLUGIN = !!juceBackend;

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
  // (1 = legato), `rhythms` biases Random rhythm picks, `program` is the
  // General MIDI instrument used in exported files, and `kind` decides its
  // part in an ensemble (mono: melody lines, poly: chords, bass: bass line).
  // `synth` names its sound in PATCHES.
  const INSTRUMENTS = {
    piano: { name: 'Piano', kind: 'poly', range: [48, 84], synth: 'piano', program: 0, leap: 1.1, rest: 0, gate: 0.9 },
    epiano: { name: 'E-piano', kind: 'poly', range: [48, 79], synth: 'keys', program: 4, leap: 1, rest: 0.02, gate: 0.9,
      rhythms: [['syncopated', 2], ['sparse', 2], ['swing', 1]] },
    organ: { name: 'Organ', kind: 'poly', range: [48, 84], synth: 'organ', program: 16, leap: 1, rest: 0.02, gate: 0.95,
      rhythms: [['straight', 2], ['offbeat', 2], ['sparse', 1]] },
    harpsichord: { name: 'Harpsichord', kind: 'poly', range: [41, 89], synth: 'harpsichord', program: 6, leap: 1.1, rest: 0, gate: 0.8,
      rhythms: [['dense', 2], ['straight', 2], ['arpeggio', 2]] },
    guitar: { name: 'Ac. guitar', kind: 'poly', range: [52, 81], synth: 'pluck', program: 25, leap: 1, rest: 0, gate: 0.8,
      rhythms: [['arpeggio', 3], ['straight', 2], ['syncopated', 2], ['tresillo', 2]] },
    eguitar: { name: 'E-guitar', kind: 'poly', range: [52, 86], synth: 'eguitar', program: 29, leap: 1.1, rest: 0.03, gate: 0.85,
      rhythms: [['syncopated', 3], ['straight', 2], ['dotted', 2], ['dense', 1]] },
    ukulele: { name: 'Ukulele', kind: 'poly', range: [60, 81], synth: 'ukulele', program: 24, leap: 1, rest: 0, gate: 0.75,
      rhythms: [['straight', 2], ['syncopated', 2], ['arpeggio', 2]] },
    harp: { name: 'Harp', kind: 'poly', range: [36, 91], synth: 'harp', program: 46, leap: 1.2, rest: 0, gate: 0.9,
      rhythms: [['arpeggio', 4], ['sparse', 1], ['triplet', 1]] },
    marimba: { name: 'Marimba', kind: 'poly', range: [48, 84], synth: 'marimba', program: 12, leap: 1, rest: 0, gate: 0.6,
      rhythms: [['dense', 3], ['arpeggio', 3], ['tresillo', 2], ['straight', 1]] },
    vibes: { name: 'Vibraphone', kind: 'poly', range: [53, 89], synth: 'vibes', program: 11, leap: 1.1, rest: 0.05, gate: 0.9,
      rhythms: [['swing', 2], ['sparse', 2], ['arpeggio', 1]] },
    kalimba: { name: 'Kalimba', kind: 'poly', range: [60, 88], synth: 'kalimba', program: 108, leap: 1, rest: 0.02, gate: 0.7,
      rhythms: [['arpeggio', 3], ['straight', 2], ['syncopated', 1]] },
    bells: { name: 'Bells', kind: 'poly', range: [67, 96], synth: 'bell', program: 10, leap: 1.1, rest: 0.03, gate: 0.9,
      rhythms: [['arpeggio', 2], ['sparse', 2], ['triplet', 1]] },
    strings: { name: 'Strings', kind: 'poly', range: [40, 86], synth: 'strings', program: 48, leap: 0.9, rest: 0.03, gate: 1,
      rhythms: [['sparse', 4], ['straight', 1]] },
    choir: { name: 'Choir', kind: 'poly', range: [48, 79], synth: 'choir', program: 52, leap: 0.8, rest: 0.05, gate: 1,
      rhythms: [['sparse', 4], ['straight', 1]] },
    pad: { name: 'Synth pad', kind: 'poly', range: [48, 76], synth: 'pad', program: 89, leap: 0.8, rest: 0.05, gate: 1,
      rhythms: [['sparse', 5], ['straight', 1]] },
    accordion: { name: 'Accordion', kind: 'poly', range: [53, 89], synth: 'accordion', program: 21, leap: 1, rest: 0.03, gate: 0.9,
      rhythms: [['offbeat', 2], ['straight', 2], ['tresillo', 1]] },
    violin: { name: 'Violin', kind: 'mono', range: [55, 88], synth: 'violin', program: 40, leap: 1.2, rest: 0.02, gate: 1,
      rhythms: [['sparse', 2], ['straight', 2], ['dotted', 2], ['triplet', 1]] },
    flute: { name: 'Flute', kind: 'mono', range: [60, 93], synth: 'flute', program: 73, leap: 1.1, rest: 0.08, gate: 0.95,
      rhythms: [['straight', 2], ['triplet', 2], ['sparse', 2], ['dense', 1]] },
    clarinet: { name: 'Clarinet', kind: 'mono', range: [50, 89], synth: 'clarinet', program: 71, leap: 1.1, rest: 0.07, gate: 0.95,
      rhythms: [['straight', 2], ['swing', 2], ['dotted', 1]] },
    oboe: { name: 'Oboe', kind: 'mono', range: [58, 91], synth: 'oboe', program: 68, leap: 1, rest: 0.07, gate: 0.95,
      rhythms: [['sparse', 2], ['straight', 2], ['dotted', 1]] },
    sax: { name: 'Saxophone', kind: 'mono', range: [49, 81], synth: 'sax', program: 65, leap: 1.2, rest: 0.08, gate: 0.95,
      rhythms: [['swing', 3], ['syncopated', 3], ['dotted', 1], ['triplet', 1]] },
    trumpet: { name: 'Trumpet', kind: 'mono', range: [55, 82], synth: 'trumpet', program: 56, leap: 0.9, rest: 0.1, gate: 0.85,
      rhythms: [['syncopated', 3], ['straight', 2], ['dotted', 2], ['offbeat', 1]] },
    horn: { name: 'French horn', kind: 'mono', range: [41, 77], synth: 'horn', program: 60, leap: 0.9, rest: 0.08, gate: 0.95,
      rhythms: [['sparse', 3], ['dotted', 2], ['straight', 1]] },
    trombone: { name: 'Trombone', kind: 'mono', range: [40, 72], synth: 'trombone', program: 57, leap: 0.8, rest: 0.1, gate: 0.9,
      rhythms: [['syncopated', 2], ['sparse', 2], ['offbeat', 1]] },
    harmonica: { name: 'Harmonica', kind: 'mono', range: [60, 84], synth: 'harmonica', program: 22, leap: 0.9, rest: 0.08, gate: 0.9,
      rhythms: [['swing', 3], ['triplet', 2], ['dotted', 1]] },
    steeldrum: { name: 'Steel drum', kind: 'mono', range: [55, 84], synth: 'steeldrum', program: 114, leap: 1, rest: 0.03, gate: 0.7,
      rhythms: [['syncopated', 3], ['tresillo', 2], ['dense', 1]] },
    synth: { name: 'Synth lead', kind: 'mono', range: [55, 86], synth: 'lead', program: 81, leap: 1, rest: 0, gate: 0.9 },
    bass: { name: 'Bass', kind: 'bass', range: [28, 55], synth: 'bass', program: 33, leap: 0.9, rest: 0.05, gate: 0.85,
      rhythms: [['syncopated', 3], ['straight', 3], ['sparse', 2], ['offbeat', 1]] },
    upright: { name: 'Upright bass', kind: 'bass', range: [28, 55], synth: 'upright', program: 32, leap: 0.9, rest: 0.04, gate: 0.8,
      rhythms: [['swing', 3], ['straight', 2], ['sparse', 1]] },
    synthbass: { name: 'Synth bass', kind: 'bass', range: [24, 55], synth: 'synthbass', program: 38, leap: 0.9, rest: 0.05, gate: 0.8,
      rhythms: [['syncopated', 3], ['offbeat', 2], ['dense', 1]] },
    cello: { name: 'Cello', kind: 'bass', range: [36, 67], synth: 'cello', program: 42, leap: 0.9, rest: 0.03, gate: 1,
      rhythms: [['sparse', 3], ['straight', 2], ['dotted', 1]] },
    tuba: { name: 'Tuba', kind: 'bass', range: [28, 58], synth: 'tuba', program: 58, leap: 0.8, rest: 0.08, gate: 0.85,
      rhythms: [['straight', 3], ['sparse', 2], ['offbeat', 1]] },
  };

  // Sound recipes, shared with the plugin: the page sends this table to it,
  // so a sound defined here plays the same in the browser and the VST3/AU.
  // Two oscillators (wave1, wave2 at ratio2 and detune2 cents, mixed by
  // mix2, fading over partialDecay seconds), an ADSR, a lowpass at
  // note frequency * cutoffMul (capped at cutoffMax) that sweeps by
  // (1 + envAmount * e^(-t/envTime)), vibrato, drive, breath noise and an
  // optional FM modulator (fmRatio, fmIndex, fmDecay).
  const PATCH_DEFAULTS = {
    wave1: 'saw', wave2: 'saw', mix2: 0, ratio2: 1, detune2: 0, partialDecay: 0,
    attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.15,
    cutoffMul: 100, cutoffMax: 16000, envAmount: 0, envTime: 0.2, q: 0.7,
    vibCents: 0, vibRate: 5, vibDelay: 0.2, drive: 0, noise: 0,
    fmRatio: 0, fmIndex: 0, fmDecay: 1, level: 0.15,
  };

  const PATCHES = {
    piano: { wave1: 'triangle', wave2: 'sine', mix2: 0.35, ratio2: 2, partialDecay: 0.6, attack: 0.003, decay: 1.8, sustain: 0.02, release: 0.25, cutoffMul: 3, envAmount: 3, envTime: 0.35, level: 0.3 },
    keys: { wave1: 'sine', wave2: 'triangle', mix2: 0.35, ratio2: 2, partialDecay: 0.4, attack: 0.005, decay: 1.2, sustain: 0.3, release: 0.3, level: 0.28 },
    organ: { wave1: 'triangle', wave2: 'sine', mix2: 0.5, ratio2: 2, attack: 0.01, decay: 0.1, sustain: 1, release: 0.08, vibCents: 6, vibRate: 6.5, vibDelay: 0.01, level: 0.14 },
    harpsichord: { wave1: 'saw', wave2: 'square', mix2: 0.3, ratio2: 2, attack: 0.002, decay: 0.9, sustain: 0.05, release: 0.2, cutoffMul: 6, envAmount: 2, envTime: 0.15, level: 0.14 },
    pluck: { wave1: 'saw', wave2: 'triangle', mix2: 0.5, ratio2: 2, detune2: -5, attack: 0.004, decay: 0.35, sustain: 0.15, release: 0.15, cutoffMul: 1.5, envAmount: 6, envTime: 0.12, q: 1.4, level: 0.22 },
    eguitar: { wave1: 'saw', wave2: 'square', mix2: 0.8, detune2: 5, drive: 3, attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.15, cutoffMax: 2800, q: 1, level: 0.1 },
    ukulele: { wave1: 'saw', wave2: 'triangle', mix2: 0.4, ratio2: 2, attack: 0.003, decay: 0.4, sustain: 0.1, release: 0.1, cutoffMul: 2, envAmount: 5, envTime: 0.08, level: 0.2 },
    harp: { wave1: 'triangle', wave2: 'sine', mix2: 0.3, ratio2: 2, partialDecay: 0.3, attack: 0.002, decay: 1.5, sustain: 0.01, release: 0.4, level: 0.3 },
    marimba: { wave1: 'sine', wave2: 'sine', mix2: 0.4, ratio2: 4, partialDecay: 0.08, attack: 0.002, decay: 0.6, sustain: 0.001, release: 0.1, level: 0.4 },
    vibes: { wave1: 'sine', wave2: 'sine', mix2: 0.2, ratio2: 4, partialDecay: 0.1, attack: 0.002, decay: 2.2, sustain: 0.02, release: 0.6, vibCents: 4, vibRate: 5, vibDelay: 0.01, level: 0.3 },
    kalimba: { wave1: 'sine', wave2: 'sine', mix2: 0.25, ratio2: 5.4, partialDecay: 0.05, attack: 0.002, decay: 0.9, sustain: 0.001, release: 0.1, level: 0.35 },
    bell: { wave1: 'sine', fmRatio: 3.5, fmIndex: 2.2, fmDecay: 1, attack: 0.002, decay: 1.4, sustain: 0.06, release: 0.5, level: 0.24 },
    strings: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 14, attack: 0.3, decay: 0.4, sustain: 0.9, release: 0.5, cutoffMax: 3000, vibCents: 6, vibRate: 5, vibDelay: 0.3, level: 0.1 },
    choir: { wave1: 'sine', wave2: 'triangle', mix2: 0.3, ratio2: 2, detune2: 6, noise: 0.02, attack: 0.25, decay: 0.3, sustain: 0.9, release: 0.4, cutoffMul: 3, vibCents: 8, vibRate: 5, level: 0.18 },
    pad: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 20, attack: 0.25, decay: 0.5, sustain: 0.8, release: 0.7, cutoffMul: 4, cutoffMax: 2400, level: 0.1 },
    accordion: { wave1: 'saw', wave2: 'square', mix2: 0.7, detune2: 12, attack: 0.03, decay: 0.1, sustain: 0.95, release: 0.08, cutoffMul: 4, q: 1, vibCents: 6, vibRate: 6.5, vibDelay: 0.01, level: 0.1 },
    violin: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 9, attack: 0.08, decay: 0.2, sustain: 0.85, release: 0.2, cutoffMax: 3800, vibCents: 12, vibRate: 5.6, vibDelay: 0.25, level: 0.12 },
    cello: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 9, attack: 0.1, decay: 0.2, sustain: 0.85, release: 0.2, cutoffMax: 2000, vibCents: 10, vibRate: 5, vibDelay: 0.25, level: 0.16 },
    flute: { wave1: 'sine', wave2: 'triangle', mix2: 0.25, noise: 0.05, attack: 0.06, decay: 0.1, sustain: 0.9, release: 0.12, cutoffMul: 4, vibCents: 8, vibRate: 5, vibDelay: 0.2, level: 0.2 },
    clarinet: { wave1: 'square', attack: 0.04, decay: 0.1, sustain: 0.9, release: 0.1, cutoffMul: 4, q: 0.9, vibCents: 5, vibRate: 5, vibDelay: 0.3, level: 0.14 },
    oboe: { wave1: 'saw', wave2: 'square', mix2: 0.5, attack: 0.03, decay: 0.1, sustain: 0.9, release: 0.1, cutoffMul: 6, q: 4, vibCents: 8, vibRate: 5.5, vibDelay: 0.25, level: 0.1 },
    sax: { wave1: 'square', wave2: 'saw', mix2: 1, detune2: 6, attack: 0.03, decay: 0.15, sustain: 0.8, release: 0.1, cutoffMul: 5, cutoffMax: 6000, envAmount: -0.6, envTime: 0.03, q: 3, vibCents: 10, vibRate: 5, vibDelay: 0.3, level: 0.12 },
    trumpet: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 7, attack: 0.025, decay: 0.15, sustain: 0.8, release: 0.08, cutoffMul: 4, cutoffMax: 7000, envAmount: -0.6, envTime: 0.03, q: 2, vibCents: 6, vibRate: 5.5, vibDelay: 0.3, level: 0.12 },
    horn: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 6, attack: 0.06, decay: 0.2, sustain: 0.85, release: 0.2, cutoffMul: 2.5, cutoffMax: 2500, envAmount: -0.5, envTime: 0.06, vibCents: 4, vibRate: 5, vibDelay: 0.3, level: 0.14 },
    trombone: { wave1: 'saw', wave2: 'saw', mix2: 1, detune2: 8, attack: 0.04, decay: 0.2, sustain: 0.85, release: 0.12, cutoffMul: 3, cutoffMax: 4000, envAmount: -0.6, envTime: 0.05, q: 1.5, level: 0.13 },
    harmonica: { wave1: 'square', wave2: 'saw', mix2: 0.5, detune2: 4, noise: 0.02, attack: 0.03, decay: 0.1, sustain: 0.9, release: 0.08, cutoffMul: 3, q: 2.5, vibCents: 10, vibRate: 5.5, vibDelay: 0.2, level: 0.12 },
    steeldrum: { wave1: 'sine', fmRatio: 2, fmIndex: 1.2, fmDecay: 0.4, attack: 0.002, decay: 0.9, sustain: 0.02, release: 0.3, level: 0.26 },
    lead: { wave1: 'saw', wave2: 'square', mix2: 1, detune2: 8, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.12, cutoffMul: 3, cutoffMax: 9000, envAmount: 1.6, envTime: 0.25, q: 2, level: 0.14 },
    bass: { wave1: 'sine', wave2: 'saw', mix2: 0.6, attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.08, cutoffMul: 3, cutoffMax: 1600, envAmount: 1.5, envTime: 0.1, q: 2, level: 0.38 },
    upright: { wave1: 'sine', wave2: 'triangle', mix2: 0.3, ratio2: 2, partialDecay: 0.25, attack: 0.005, decay: 0.6, sustain: 0.25, release: 0.12, level: 0.42 },
    synthbass: { wave1: 'saw', wave2: 'square', mix2: 0.7, ratio2: 0.5, attack: 0.003, decay: 0.25, sustain: 0.5, release: 0.05, cutoffMul: 2.5, cutoffMax: 2000, envAmount: 4, envTime: 0.08, q: 3, level: 0.3 },
    tuba: { wave1: 'saw', wave2: 'sine', mix2: 0.8, attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.1, cutoffMul: 2, cutoffMax: 1200, level: 0.3 },
    backing: { wave1: 'triangle', wave2: 'saw', mix2: 0.5, detune2: 7, attack: 0.05, decay: 0.6, sustain: 0.6, release: 0.3, cutoffMax: 1400, level: 0.06 },
    backingBass: { wave1: 'sine', wave2: 'triangle', mix2: 1, attack: 0.01, decay: 0.4, sustain: 0.55, release: 0.15, level: 0.18 },
  };

  const patchFor = (name) => Object.assign({}, PATCH_DEFAULTS, PATCHES[name] || PATCHES.piano);

  const noteLabel = (midi) => NOTE_NAMES[mod(midi, 12)] + (Math.floor(midi / 12) - 1);
  const rangeLabel = (inst) => `${noteLabel(inst.range[0])}–${noteLabel(inst.range[1])}`;
  const isKind = (key, kind) => INSTRUMENTS[key] && INSTRUMENTS[key].kind === kind;

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
      instruments: [['piano', 3], ['guitar', 2], ['synth', 2], ['epiano', 1], ['bells', 1], ['ukulele', 1]],
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
      instruments: [['eguitar', 5], ['organ', 1], ['synth', 1], ['piano', 1]],
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
      instruments: [['sax', 4], ['piano', 3], ['trumpet', 3], ['epiano', 2], ['vibes', 2], ['clarinet', 1], ['trombone', 1], ['flute', 1]],
      leap: 0.45, rest: 0.1, sevenths: true, swing: { unit: 24, ratio: 0.66 },
    },
    blues: {
      name: 'Blues', bpm: [70, 120],
      scales: [['blues', 5], ['minorPentatonic', 3], ['mixolydian', 1]],
      rhythms: [['swing', 4], ['triplet', 4], ['dotted', 1]],
      meters: [['4/4', 8], ['12/8', 4]],
      prog: { major: [[0, 3, 0, 0], [0, 3, 0, 4], [4, 3, 0, 4]] },
      instruments: [['eguitar', 3], ['harmonica', 3], ['sax', 2], ['organ', 2], ['piano', 2], ['trumpet', 1]],
      leap: 0.3, rest: 0.15, sevenths: true, swing: { unit: 24, ratio: 0.66 },
    },
    funk: {
      name: 'Funk', bpm: [92, 115],
      scales: [['dorian', 4], ['mixolydian', 3], ['minorPentatonic', 3]],
      rhythms: [['syncopated', 6], ['dense', 2], ['offbeat', 2]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 3, 0, 3], [0, 0, 3, 3]], minor: [[0, 3, 0, 3], [0, 6, 3, 0]] },
      instruments: [['eguitar', 2], ['epiano', 2], ['organ', 2], ['sax', 1], ['synth', 1], ['trumpet', 1]],
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
      instruments: [['epiano', 3], ['piano', 2], ['bells', 2], ['flute', 1], ['strings', 1]],
      leap: 0.25, rest: 0.2, sevenths: true, swing: { unit: 12, ratio: 0.58 },
    },
    trap: {
      name: 'Trap', bpm: [130, 160],
      scales: [['minor', 4], ['harmonicMinor', 3], ['phrygian', 2]],
      rhythms: [['triplet', 3], ['sparse', 3], ['syncopated', 2], ['arpeggio', 2]],
      meters: [['4/4', 1]],
      prog: { major: [[0, 5, 3, 4]], minor: [[0, 5, 4, 0], [0, 5, 2, 4], [0, 0, 5, 6]] },
      instruments: [['bells', 4], ['flute', 2], ['synth', 2], ['piano', 1], ['choir', 1]],
      leap: 0.3, rest: 0.25,
    },
    lofi: {
      name: 'Lo-fi', bpm: [70, 90],
      scales: [['major', 2], ['dorian', 3], ['minor', 2], ['majorPentatonic', 2]],
      rhythms: [['sparse', 3], ['syncopated', 3], ['swing', 2], ['dotted', 1]],
      meters: [['4/4', 1]],
      prog: { major: [[3, 2, 1, 0], [1, 4, 0, 5], [3, 4, 2, 5]], minor: [[0, 3, 6, 2], [1, 4, 0, 0]] },
      instruments: [['epiano', 4], ['guitar', 2], ['piano', 2], ['vibes', 1], ['kalimba', 1]],
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
      instruments: [['organ', 2], ['epiano', 2], ['guitar', 2], ['trumpet', 1], ['sax', 1], ['harmonica', 1]],
      leap: 0.25, rest: 0.15, swing: { unit: 12, ratio: 0.58 },
    },
    latin: {
      name: 'Latin', bpm: [90, 130],
      scales: [['minor', 3], ['harmonicMinor', 2], ['major', 3], ['phrygian', 1]],
      rhythms: [['tresillo', 6], ['syncopated', 3]],
      meters: [['4/4', 8], ['6/8', 2]],
      prog: { major: [[0, 4, 4, 0], [0, 3, 4, 0]], minor: [[0, 3, 4, 0], [0, 6, 5, 4]] },
      instruments: [['guitar', 4], ['trumpet', 2], ['marimba', 2], ['steeldrum', 2], ['accordion', 1], ['flute', 1]],
      leap: 0.3, rest: 0.1,
    },
    classical: {
      name: 'Classical', bpm: [60, 132],
      scales: [['major', 4], ['minor', 2], ['harmonicMinor', 3]],
      rhythms: [['straight', 3], ['dotted', 2], ['arpeggio', 2], ['triplet', 1]],
      meters: [['4/4', 6], ['3/4', 5], ['2/4', 2], ['6/8', 2]],
      prog: { major: [[0, 3, 4, 0], [0, 5, 1, 4], [0, 1, 4, 0]], minor: [[0, 3, 4, 0], [0, 5, 3, 4]] },
      instruments: [['piano', 4], ['violin', 4], ['strings', 2], ['flute', 2], ['clarinet', 2], ['oboe', 2], ['harp', 2], ['horn', 1], ['harpsichord', 1]],
      leap: 0.35, rest: 0.05,
    },
    ambient: {
      name: 'Ambient', bpm: [60, 90],
      scales: [['lydian', 3], ['major', 2], ['majorPentatonic', 3], ['dorian', 2]],
      rhythms: [['sparse', 8], ['straight', 1]],
      meters: [['4/4', 5], ['3/4', 2], ['6/8', 2], ['5/4', 1]],
      prog: { major: [[0, 3, 0, 3], [0, 5, 3, 0]], minor: [[0, 5, 3, 6]] },
      instruments: [['pad', 4], ['bells', 2], ['choir', 2], ['harp', 2], ['strings', 1], ['piano', 1], ['flute', 1]],
      leap: 0.4, rest: 0.25, sevenths: true,
    },
    prog: {
      name: 'Prog / Math rock', bpm: [100, 150],
      scales: [['minor', 3], ['dorian', 2], ['lydian', 2], ['phrygian', 1]],
      rhythms: [['syncopated', 3], ['dense', 2], ['straight', 2], ['dotted', 1]],
      meters: [['7/8', 4], ['5/4', 3], ['7/4', 2], ['9/8', 1], ['11/8', 1], ['5/8', 1]],
      prog: { major: [[0, 1, 4, 5]], minor: [[0, 5, 6, 0], [0, 3, 5, 6]] },
      instruments: [['eguitar', 3], ['synth', 3], ['organ', 1], ['piano', 1]],
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
      instruments: ['marimba', 'guitar', 'bells', 'flute', 'ukulele', 'steeldrum'],
    },
    sad: {
      name: 'Sad', tempo: 0.8, leap: 0.8, rest: 0.06, register: -5,
      scales: [['minor', 5], ['harmonicMinor', 2], ['dorian', 1], ['minorPentatonic', 1]],
      rhythms: [['sparse', 4], ['straight', 2], ['dotted', 2]],
      instruments: ['piano', 'cello', 'violin', 'oboe', 'strings'],
    },
    dark: {
      name: 'Dark', tempo: 0.9, leap: 1, rest: 0.05, register: -12,
      scales: [['phrygian', 4], ['harmonicMinor', 3], ['minor', 2]],
      rhythms: [['sparse', 3], ['syncopated', 2], ['triplet', 2]],
      instruments: ['cello', 'synth', 'choir', 'horn'],
    },
    dreamy: {
      name: 'Dreamy', tempo: 0.85, leap: 1.3, rest: 0.04, register: 5,
      scales: [['lydian', 5], ['majorPentatonic', 3], ['major', 1], ['dorian', 1]],
      rhythms: [['sparse', 3], ['arpeggio', 3], ['triplet', 2]],
      instruments: ['pad', 'bells', 'epiano', 'harp', 'vibes', 'kalimba'],
    },
    calm: {
      name: 'Calm', tempo: 0.85, leap: 0.7, rest: 0.05, register: 0,
      scales: [['majorPentatonic', 5], ['major', 2], ['dorian', 1]],
      rhythms: [['sparse', 4], ['straight', 3]],
      instruments: ['piano', 'guitar', 'flute', 'harp', 'kalimba'],
    },
    energetic: {
      name: 'Energetic', tempo: 1.15, leap: 1.1, rest: -0.05, register: 5,
      scales: [['minor', 2], ['major', 2], ['minorPentatonic', 2], ['mixolydian', 1]],
      rhythms: [['dense', 3], ['syncopated', 3], ['offbeat', 2], ['arpeggio', 2]],
      instruments: ['synth', 'eguitar', 'trumpet', 'organ'],
    },
    tense: {
      name: 'Tense', tempo: 1.05, leap: 1.4, rest: 0, register: 0,
      scales: [['harmonicMinor', 4], ['phrygian', 3], ['minor', 1]],
      rhythms: [['syncopated', 3], ['dense', 2], ['triplet', 2]],
      instruments: ['violin', 'cello', 'synth', 'strings'],
    },
    mysterious: {
      name: 'Mysterious', tempo: 0.9, leap: 1.2, rest: 0.05, register: 0,
      scales: [['dorian', 3], ['phrygian', 2], ['harmonicMinor', 2], ['lydian', 1]],
      rhythms: [['triplet', 3], ['sparse', 3], ['syncopated', 2]],
      instruments: ['bells', 'flute', 'cello', 'choir', 'vibes'],
    },
    romantic: {
      name: 'Romantic', tempo: 0.9, leap: 1.1, rest: 0.02, register: 0,
      scales: [['major', 3], ['minor', 2], ['harmonicMinor', 2]],
      rhythms: [['dotted', 3], ['triplet', 2], ['straight', 2]],
      instruments: ['violin', 'piano', 'sax', 'strings', 'harp'],
    },
    epic: {
      name: 'Epic', tempo: 1, leap: 1.3, rest: 0, register: 5,
      scales: [['minor', 4], ['harmonicMinor', 2], ['dorian', 1]],
      rhythms: [['dotted', 3], ['straight', 2], ['triplet', 2]],
      instruments: ['trumpet', 'horn', 'strings', 'choir', 'trombone'],
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

  // Free time signatures: any beat unit works, e.g. 7/5 or 4/3. Rhythms are
  // written on the nearest power-of-two grid (5 -> 4, 3 -> 2, 12 -> 16) and
  // time is scaled so each beat lasts exactly 1/den of a whole note. MIDI can
  // only store power-of-two beat units, so exports use that grid plus a
  // matching tempo change, which sounds identical.
  function gridDen(den) {
    return clamp(Math.pow(2, Math.round(Math.log2(den))), 1, 64);
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
        den = weighted([[4, 3], [8, 3], [16, 1], [2, 1], [3, 0.5], [6, 0.5], [5, 0.3], [12, 0.3], [7, 0.2]]);
        num = numeratorFor(gridDen(den));
      } else {
        [num, den] = weighted(g.meters).split('/').map(Number);
      }
      rolled.meter = true;
    } else if (!num) {
      num = numeratorFor(gridDen(den));
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
    let bassInstrument = autoBass(genre);
    let ensemble = null;
    if (mode === 'chords') {
      chordInstrument = roll('instrument', input.instrument, () => pickChordInstrument(g, md));
      instrument = leadPick();
    } else if (mode === 'ensemble') {
      // Any number of instruments; Random picks a lead, chords and bass.
      ensemble = input.instruments && input.instruments.length ? input.instruments.slice() : null;
      if (!ensemble) {
        rolled.instrument = true;
        const lead = leadPick();
        ensemble = [lead, pickChordInstrument(g, md, lead), bassInstrument];
      }
      const roles = ensembleRoles(ensemble);
      instrument = roles[0].instrument;
      chordInstrument = (roles.find((r) => r.role === 'chords') || {}).instrument || pickChordInstrument(g, md, instrument);
      bassInstrument = (roles.find((r) => r.role === 'bass') || {}).instrument || bassInstrument;
    } else {
      instrument = roll('instrument', input.instrument, leadPick);
      chordInstrument = pickChordInstrument(g, md, instrument);
    }
    const inst = INSTRUMENTS[mode === 'chords' ? chordInstrument : instrument];
    const rhythm = roll('rhythm', input.rhythm, () => {
      const base = blendWeights(g.rhythms, md.rhythms);
      return weighted(inst.rhythms ? blendWeights(base, inst.rhythms) : base);
    });

    return { mode, genre, mood, bpm, num, den, root, scale, length, rhythm, instrument, chordInstrument, bassInstrument, ensemble, rolled };
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
    const groups = beatGroups(s.num, gridDen(s.den));
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
      gridDen: gridDen(s.den),
      // Seconds per grid tick are scaled by this (1 for power-of-two meters).
      tickScale: gridDen(s.den) / s.den,
    });
    buildParts(m);
    return m;
  }

  // ---------------------------------------------------------------------
  // | Arrangement: chord and bass parts                                 |
  // ---------------------------------------------------------------------


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
      .filter(([k]) => isKind(k, 'poly') && k !== avoid);
    return entries.length ? weighted(entries) : 'piano';
  }

  const BASS_BY_GENRE = { classical: 'cello', jazz: 'upright', blues: 'upright', funk: 'synthbass', edm: 'synthbass', trap: 'synthbass', hiphop: 'synthbass' };
  const autoBass = (genre) => BASS_BY_GENRE[genre] || 'bass';

  // Scale-degree helpers for parts and edits: index 0 is the tonic in the
  // lowest octave, n (scale length) the tonic an octave up.
  function midiToIdx(m, midi) {
    const steps = SCALES[m.scale].steps;
    const n = steps.length;
    const rel = midi - m.root;
    const octave = Math.floor(rel / 12);
    const pc = mod(rel, 12);
    let best = 0;
    let bestDist = 99;
    steps.concat([12]).forEach((st, i) => {
      if (Math.abs(st - pc) < bestDist) {
        bestDist = Math.abs(st - pc);
        best = i;
      }
    });
    return octave * n + best;
  }

  function idxToMidiOf(m, idx) {
    const steps = SCALES[m.scale].steps;
    const n = steps.length;
    return m.root + 12 * Math.floor(idx / n) + steps[mod(idx, n)];
  }

  function fitRange(midi, key) {
    const [low, high] = INSTRUMENTS[key].range;
    let n = midi;
    while (n < low) n += 12;
    while (n > high) n -= 12;
    return n < low ? low : n;
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
      seed: randInt(1, 2147483646),
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

  // style: 'comp' (rhythmic chords), 'arp' (broken chords) or 'pad' (held).
  function chordPart(m, key, style) {
    ensureGroove(m);
    const [ilo, ihi] = INSTRUMENTS[key].range;
    const lo = clamp(50, ilo, ihi - 16);
    const hi = Math.min(ihi, Math.max(lo + 17, 79));
    const strong = new Set(groupStarts(m.groups));
    const poly = isKind(key, 'poly');
    const broken = style === 'arp' || !poly || COMP_STYLE[m.rhythm] === 'arpeggio';
    const notes = [];
    let prev = null;
    m.chords.forEach((c, bar) => {
      const voicing = voiceChord(c.pcs, prev, lo, hi);
      prev = voicing;
      const base = bar * m.barTicks;
      const last = bar === m.chords.length - 1;
      if (style === 'pad') {
        voicing.forEach((midi) => notes.push({ tick: base, dur: m.barTicks, midi, vel: 0.6 }));
        return;
      }
      if (broken && !(last && poly)) {
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

  function bassPart(m, key) {
    ensureGroove(m);
    const [low, high] = INSTRUMENTS[key].range;
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
    // Seeded per song, so the line stays the same when other parts are
    // edited and only changes with the chords.
    let seed = (m.groove.seed || 1) + key.length * 7919;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const chanceS = (p) => rand() < p;
    const pickS = (list) => list[Math.floor(rand() * list.length)];
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
        else if (i === played.length - 1 && nextRoot !== null && nextRoot !== root && chanceS(style === 'walking' ? 0.8 : 0.35)) midi = nextRoot + (nextRoot > root ? -1 : 1);
        else if (style === 'walking') midi = pickS([third, fifth, root + 12]);
        else midi = strong.has(it.start) ? pickS([fifth, root, root + 12]) : pickS([root, root, fifth]);
        notes.push({ tick: base + it.start, dur: it.dur, midi: fit(midi), vel: it.start === 0 ? 0.9 : 0.74 });
      });
    });
    return notes;
  }

  // A second melody line a third (or sixth) below the lead, in the scale.
  function harmonyPart(m, key, interval) {
    return m.notes.map((n) => ({
      tick: n.tick, dur: n.dur, midi: fitRange(idxToMidiOf(m, midiToIdx(m, n.midi) + interval), key), vel: n.vel * 0.85,
    }));
  }

  // Held chord tones, one per beat group, moving as little as possible.
  function counterPart(m, key) {
    const [low, high] = INSTRUMENTS[key].range;
    const notes = [];
    let prev = Math.round((low + high) / 2);
    m.chords.forEach((c, bar) => {
      let pos = 0;
      m.groups.forEach((len, gi) => {
        if (gi % 2 === 0) {
          const span = gi + 1 < m.groups.length ? len + m.groups[gi + 1] : len;
          let best = prev;
          let bestDist = 99;
          for (let n = low; n <= high; n++) {
            if (c.pcs.includes(mod(n, 12)) && Math.abs(n - prev) < bestDist && n !== prev) {
              bestDist = Math.abs(n - prev);
              best = n;
            }
          }
          notes.push({ tick: bar * m.barTicks + pos, dur: span, midi: best, vel: 0.62 });
          prev = best;
        }
        pos += len;
      });
    });
    return notes;
  }

  const PART_NAMES = { lead: 'Lead', harmony: 'Harmony', counter: 'Counter-line', chords: 'Chords', arp: 'Arpeggio', pad: 'Pad', bass: 'Bass' };

  // Gives each chosen instrument a part: the first melodic instrument plays
  // the melody, further ones harmonise; chord instruments comp, then
  // arpeggiate, then hold pads; low instruments play (and double) the bass.
  const SUSTAINED = new Set(['strings', 'choir', 'pad', 'organ', 'accordion']);

  function ensembleRoles(keys) {
    const of = (kind) => keys.filter((k) => isKind(k, kind));
    const lead = of('mono')[0] || of('poly')[0] || keys[0];
    const roles = [{ id: 'lead', role: 'lead', instrument: lead }];
    of('mono').filter((k) => k !== lead).forEach((k, i) => {
      roles.push(i % 3 === 1 ?
        { id: `counter${i}`, role: 'counter', instrument: k } :
        { id: `harmony${i}`, role: 'harmony', instrument: k, interval: i % 3 === 2 ? -5 : -2 });
    });
    // The first chord instrument comps; after that, sustained ones hold
    // pads and plucked or struck ones play arpeggios.
    of('poly').filter((k) => k !== lead).forEach((k, i) => {
      const role = i === 0 ? 'chords' : (SUSTAINED.has(k) ? 'pad' : 'arp');
      roles.push({ id: i === 0 ? 'chords' : `${role}${i}`, role, instrument: k });
    });
    of('bass').filter((k) => k !== lead).forEach((k, i) => {
      roles.push({ id: i === 0 ? 'bass' : `bass${i}`, role: 'bass', instrument: k });
    });
    return roles;
  }

  const PART_BUILDERS = {
    lead: (m) => m.notes,
    harmony: (m, r) => harmonyPart(m, r.instrument, r.interval),
    counter: (m, r) => counterPart(m, r.instrument),
    chords: (m, r) => chordPart(m, r.instrument, 'comp'),
    arp: (m, r) => chordPart(m, r.instrument, 'arp'),
    pad: (m, r) => chordPart(m, r.instrument, 'pad'),
    bass: (m, r) => bassPart(m, r.instrument),
  };

  const partNotes = (m, r) => PART_BUILDERS[r.role](m, r);

  // The parts that play (and export) in the song's current mode. Notes the
  // user edited in the piano roll (m.edits, by part id) replace generated ones.
  function buildParts(m) {
    let roles;
    if (m.mode === 'melody') roles = [{ id: 'lead', role: 'lead', instrument: m.instrument }];
    else if (m.mode === 'chords') roles = [{ id: 'chords', role: 'chords', instrument: m.chordInstrument }, { id: 'bass', role: 'bass', instrument: m.bassInstrument }];
    else roles = ensembleRoles(m.ensemble && m.ensemble.length ? m.ensemble : [m.instrument, m.chordInstrument, m.bassInstrument]);
    m.edits = m.edits || {};
    m.parts = roles.map((r) => Object.assign({}, r, { notes: r.role === 'lead' ? m.notes : (m.edits[r.id] || partNotes(m, r)) }));
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
    if (IN_PLUGIN) {
      // A stand-in clock so shared code paths keep working; the plugin plays.
      if (!audio.ctx) audio.ctx = { currentTime: 0, state: 'running', resume() {} };
      return audio.ctx;
    }
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

  // Plays one note of a PATCHES recipe (the plugin's C++ engine follows the
  // same recipe).
  function playTone(midi, time, dur, vel, synthName, dest) {
    const ctx = audio.ctx;
    const p = patchFor(synthName);
    const f = mtof(midi);
    const waveType = (w) => (w === 'saw' ? 'sawtooth' : w);
    const amp = ctx.createGain();
    amp.connect(dest);
    const end = envelope(amp.gain, time, dur, p.level * vel * 1.6, Math.max(0.002, p.attack), p.decay, Math.max(0.0005, p.sustain), p.release);

    // Signal chain: oscillators -> (drive) -> (lowpass) -> amp
    let input = amp;
    const filtered = p.cutoffMul < 99 || p.cutoffMax < 15000;
    if (filtered) {
      const filt = lowpass(Math.min(f * p.cutoffMul, p.cutoffMax), p.q * 1.4, amp);
      if (p.envAmount !== 0) {
        const startCut = Math.max(30, Math.min(f * p.cutoffMul * (1 + p.envAmount), p.cutoffMax));
        filt.frequency.setValueAtTime(startCut, time);
        filt.frequency.setTargetAtTime(Math.min(f * p.cutoffMul, p.cutoffMax), time, Math.max(0.005, p.envTime));
      }
      input = filt;
    }
    if (p.drive > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve();
      shaper.connect(input);
      const pre = ctx.createGain();
      pre.gain.value = p.drive / 5;
      pre.connect(shaper);
      input = pre;
    }

    const oscs = [];
    if (p.fmRatio > 0) {
      const carrier = osc('sine', f, time, end, input);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(f * p.fmIndex, time);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), time + p.fmDecay);
      modGain.connect(carrier.frequency);
      osc('sine', f * p.fmRatio, time, end, modGain);
      oscs.push(carrier);
    } else {
      oscs.push(osc(waveType(p.wave1), f, time, end, input));
      if (p.mix2 > 0) {
        const g2 = ctx.createGain();
        g2.connect(input);
        g2.gain.setValueAtTime(p.mix2, time);
        if (p.partialDecay > 0) g2.gain.setTargetAtTime(0.0001, time, p.partialDecay);
        oscs.push(osc(waveType(p.wave2), f * p.ratio2, time, end, g2, p.detune2));
      }
    }
    if (p.vibCents > 0) vibrato(oscs, f, time, end, p.vibCents, p.vibRate, Math.max(0.01, p.vibDelay));
    if (p.noise > 0) noiseSource(time, end, filter('bandpass', Math.min(f * 2, 12000), 2, decayGain(time, p.noise * 2, Math.max(0.15, dur), input)));
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
    num: 4,
    den: 4,
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

  // Grid steps per beat: 16th notes for straight time (a quarter-note beat
  // gets 4, an eighth-note beat 2, a half-note beat 8), 3 for triplets.
  const straightSteps = () => clamp(16 / gridDen(drum.den), 1, 16);
  const stepsPerBeat = () => (drum.triplet ? 3 : straightSteps());
  const stepCount = () => drum.num * stepsPerBeat();
  const currentRows = () => (drum.triplet ? drum.trip : drum.straight);

  // Re-fits a pattern to another meter beat by beat: beat b takes the
  // rhythm of source beat (b mod source beats), and each step keeps its
  // position inside the beat when the new grid has it.
  function fitRows(rows, beats1, spb1, beats2, spb2) {
    const out = emptyRows(beats2 * spb2);
    DRUMS.forEach((d) => {
      for (let b = 0; b < beats2; b++) {
        for (let st = 0; st < spb2; st++) {
          const pos = (st * spb1) / spb2;
          if (Number.isInteger(pos)) out[d.id][b * spb2 + st] = rows[d.id][(b % beats1) * spb1 + pos];
        }
      }
    });
    return out;
  }

  function loadPreset(key) {
    const p = PRESETS[key];
    drum.preset = key;
    drum.bpm = p.bpm;
    drum.kit = p.kit;
    drum.swing = p.swing;
    // Presets are written as one bar of 4/4 and fitted to the current meter.
    const straight = emptyRows(16);
    Object.keys(p.steps).forEach((id) => {
      straight[id] = parseRow(p.steps[id], 16);
    });
    const trip = convertRows(straight, 16, 12);
    if (p.trip) {
      Object.keys(p.trip).forEach((id) => {
        trip[id] = parseRow(p.trip[id], 12);
      });
    }
    drum.source = { straight, trip, beats: 4, spb: 4 };
    drum.straight = fitRows(straight, 4, 4, drum.num, straightSteps());
    drum.trip = fitRows(trip, 4, 3, drum.num, 3);
    drum.stale = { straight: false, trip: false };
    drum.triplet = !!p.triplet;
  }

  // Changes the drum meter. The pattern is always fitted from its source
  // (the preset, or the bar as last edited), so trying other meters and
  // coming back loses nothing.
  function setDrumMeter(num, den) {
    num = clamp(Math.round(num) || drum.num, 1, 255);
    den = clamp(Math.round(den) || drum.den, 1, 9999);
    if (num === drum.num && den === drum.den) return false;
    const oldCount = stepCount();
    const src = drum.source;
    drum.num = num;
    drum.den = den;
    drum.straight = fitRows(src.straight, src.beats, src.spb, num, straightSteps());
    drum.trip = fitRows(src.trip, src.beats, 3, num, 3);
    dp.step = Math.floor((dp.step * stepCount()) / oldCount) % stepCount();
    return true;
  }

  function setTriplet(on) {
    if (on === drum.triplet) return;
    const straightCount = drum.num * straightSteps();
    const tripCount = drum.num * 3;
    if (on && drum.stale.trip) {
      drum.trip = convertRows(drum.straight, straightCount, tripCount);
      drum.stale.trip = false;
    } else if (!on && drum.stale.straight) {
      drum.straight = convertRows(drum.trip, tripCount, straightCount);
      drum.stale.straight = false;
    }
    const before = stepCount();
    drum.triplet = on;
    dp.step = Math.floor((dp.step * stepCount()) / before) % stepCount();
  }

  function markEdited() {
    if (drum.triplet) drum.stale.straight = true;
    else drum.stale.trip = true;
    drum.source = { straight: drum.straight, trip: drum.trip, beats: drum.num, spb: straightSteps() };
  }

  // Length of one grid step in seconds.
  // A beat lasts 4/den quarter notes, so 7/5 beats are 4/5 of a quarter.
  function drumStepDur(bpm) {
    return ((60 / (bpm || drum.bpm)) * (4 / drum.den) / stepsPerBeat()) * FEELS[drum.feel];
  }

  // Swing delays every second 16th, so it needs an even grid.
  const canSwing = () => !drum.triplet && straightSteps() % 2 === 0;

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
  const ROLE_LEVEL = { lead: 1, harmony: 0.75, counter: 0.7, chords: 0.55, arp: 0.65, pad: 0.45, bass: 0.9 };

  // MIDI channel (1-16) for each part in order, skipping drum channel 10;
  // melody mode's backing chords take the next free one.
  const PART_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
  const partChannel = (i) => PART_CHANNELS[Math.min(i, PART_CHANNELS.length - 1)];

  function melodyEvents(m) {
    const spt = (60 / (m.bpm * TPQ)) * m.tickScale;
    const events = [];
    m.parts.forEach((part, pi) => {
      const inst = INSTRUMENTS[part.instrument];
      part.notes.forEach((n) => {
        const start = swingTick(n.tick, m.swing) * spt;
        const end = swingTick(n.tick + n.dur, m.swing) * spt;
        events.push({
          type: 'note', role: part.role, synth: inst.synth, channel: partChannel(pi), time: start,
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
    if (IN_PLUGIN) {
      if (!melody) return;
      mp.playing = true;
      updatePlayButtons();
      pushPluginState(true);
      return;
    }
    if (!melody) return;
    initAudio();
    fadeOut(mp.out);
    const built = melodyEvents(melody);
    Object.assign(mp, built, { playing: true, idx: 0, loopStart: at, firstStart: at, out: newOutput(audio.melodyBus) });
    updatePlayButtons();
    startTimer();
  }

  function stopMelody() {
    if (IN_PLUGIN) {
      mp.playing = false;
      updatePlayButtons();
      pushPluginState(true);
      return;
    }
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
      else if ($('m-chords').checked) playChord(ev.chord, t, ev.dur, mp.out, !isKind(melody.instrument, 'bass'));
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
    if (IN_PLUGIN) {
      dp.playing = true;
      updatePlayButtons();
      pushPluginState(true);
      return;
    }
    initAudio();
    fadeOut(dp.out);
    Object.assign(dp, { playing: true, step: 0, nextTime: at, out: newOutput(audio.drumFilter), queue: [], shown: -1 });
    updatePlayButtons();
    startTimer();
  }

  function stopDrums() {
    if (IN_PLUGIN) {
      dp.playing = false;
      showStep(-1);
      updatePlayButtons();
      pushPluginState(true);
      return;
    }
    dp.playing = false;
    if (audio.ctx) fadeOut(dp.out);
    dp.out = null;
    dp.queue = [];
    showStep(-1);
    updatePlayButtons();
    stopTimerIfIdle();
  }

  function triggerDrum(id, time, vel, out) {
    if (IN_PLUGIN) {
      sendToPlugin({ type: 'preview', drum: DRUMS.findIndex((d) => d.id === id), vel });
      return;
    }
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
      if (canSwing() && dp.step % 2 === 1) t += (sd * drum.swing) / 300;
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
    if (IN_PLUGIN) {
      sendToPlugin({ type: 'saveFile', name, data: toBase64(bytes) });
      return;
    }
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
      tempoEvent(m.bpm / m.tickScale),
      { tick: 0, bytes: [0xff, 0x58, 0x04, m.num, Math.log2(m.gridDen), 24, 8] },
      { tick: 0, bytes: [0xff, 0x59, 0x02, sf & 255, scale.minor ? 1 : 0] },
    ];

    const tracks = m.parts.map((part, pi) => {
      const inst = INSTRUMENTS[part.instrument];
      const ch = partChannel(pi) - 1;
      let track = [
        { tick: 0, bytes: textEvent(0x03, `${PART_NAMES[part.role]} - ${inst.name}`) },
        { tick: 0, bytes: [0xc0 | ch, inst.program] },
      ];
      part.notes.forEach((n) => {
        const start = at(n.tick);
        const vel = Math.round(clamp(n.vel * (['chords', 'pad', 'arp'].includes(part.role) ? 90 : 110), 1, 127));
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
          chords = chords.concat(noteEvents(partChannel(m.parts.length) - 1, start, dur, note, 70));
        });
        if (!isKind(m.instrument, 'bass')) chords = chords.concat(noteEvents(partChannel(m.parts.length) - 1, start, dur, 36 + c.pcs[0], 85));
      });
      tracks.push(chords);
    }

    return { conductor, tracks, length: m.totalTicks * k };
  }

  // The drum pattern on channel 10, looped until `length` ticks (by default
  // about four bars). `quarterTicks` is how many file ticks one real quarter
  // note lasts, which differs from MIDI_TPQ in free meters.
  function drumTrack(length, quarterTicks) {
    const rows = currentRows();
    const steps = stepCount();
    const stepTicks = ((quarterTicks * (4 / drum.den)) / stepsPerBeat()) * FEELS[drum.feel];
    const loopTicks = steps * stepTicks;
    const end = length || Math.max(1, Math.round(4 / FEELS[drum.feel])) * loopTicks;
    let track = [{ tick: 0, bytes: textEvent(0x03, `Drums - ${PRESETS[drum.preset].name}`) }];
    for (let base = 0; base < end; base += loopTicks) {
      for (let s = 0; s < steps; s++) {
        let tick = base + s * stepTicks;
        if (tick >= end) break;
        if (canSwing() && s % 2 === 1) tick += (stepTicks * drum.swing) / 300;
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

  function songMidi(withDrums) {
    const t = melodyTracks(melody);
    const tracks = [t.conductor].concat(t.tracks);
    if (withDrums) tracks.push(drumTrack(t.length, MIDI_TPQ / melody.tickScale));
    return { bytes: midiFile(tracks), name: melodyName(melody, withDrums ? '-with-drums' : '') };
  }

  function drumsMidi() {
    const scale = gridDen(drum.den) / drum.den;
    const conductor = [tempoEvent(drum.bpm / scale), { tick: 0, bytes: [0xff, 0x58, 0x04, drum.num, Math.log2(gridDen(drum.den)), 24, 8] }];
    const name = `drums-${PRESETS[drum.preset].name}-${drum.num}-${drum.den}-${drum.feel}${drum.triplet ? '-triplet' : ''}-${drum.bpm}bpm.mid`;
    return { bytes: midiFile([conductor, drumTrack(0, MIDI_TPQ / scale)]), name: fileName(name) };
  }

  function exportMelody() {
    if (!melody) return;
    const f = songMidi(false);
    saveFile(f.bytes, f.name);
  }

  // Melody, chords and drums in one file, at the melody's tempo and length
  // (the same way Play all plays them together).
  function exportMelodyAndDrums() {
    if (!melody) return;
    const f = songMidi(true);
    saveFile(f.bytes, f.name);
  }

  function exportDrums() {
    const f = drumsMidi();
    saveFile(f.bytes, f.name);
  }

  // ---------------------------------------------------------------------
  // | Piano roll                                                        |
  // ---------------------------------------------------------------------

  const roll = { canvas: null, ctx: null, cache: null, w: 0, h: 0, touchedAt: 0, editId: 'lead', tool: 'scroll', snap: 12, layout: null, drag: null };
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const CHORD_LANE = 22;

  // Narrow screens scroll the roll sideways instead of squashing the notes.
  // Very long songs (huge bars) get fewer pixels per beat so the canvas
  // stays under browser size limits.
  const ROLL_PX_PER_QUARTER = 16;
  const ROLL_MAX_WIDTH = 16000;

  // Rows stay tall enough to click; a wide ensemble scrolls up and down.
  const ROLL_MIN_ROW = 7;

  function sizeRoll() {
    const c = roll.canvas;
    // Hidden behind the drum machine tab: sized when shown again.
    if (!c.offsetParent) return;
    const minW = melody ? Math.min(ROLL_MAX_WIDTH, (melody.totalTicks / TPQ) * ROLL_PX_PER_QUARTER) : 0;
    c.style.width = `${Math.max(c.parentElement.clientWidth, Math.ceil(minW))}px`;
    c.style.height = '';
    if (melody) {
      const span = pitchSpan();
      const needed = CHORD_LANE + (span.maxP - span.minP + 1) * ROLL_MIN_ROW;
      if (needed > c.clientHeight) c.style.height = `${Math.ceil(needed)}px`;
    }
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

  // The visible pitch range covers every part plus some room to drag notes
  // into; it stays put while a note is being dragged.
  // The range stays put while editing (so rows don't jump under the
  // pointer) unless a note moves outside it.
  function pitchSpan() {
    const pitches = [];
    melody.parts.forEach((part) => part.notes.forEach((n) => pitches.push(n.midi)));
    if (!pitches.length) pitches.push(60);
    const kept = roll.span;
    if (kept && pitches.every((pp) => pp >= kept.minP && pp <= kept.maxP)) return kept;
    let minP = Math.min.apply(null, pitches) - 3;
    let maxP = Math.max.apply(null, pitches) + 3;
    if (maxP - minP < 24) {
      const extra = 24 - (maxP - minP);
      minP -= Math.floor(extra / 2);
      maxP += Math.ceil(extra / 2);
    }
    if (kept) {
      minP = Math.min(minP, kept.minP);
      maxP = Math.max(maxP, kept.maxP);
    }
    roll.span = { minP, maxP };
    return roll.span;
  }

  function rollLayout() {
    if (roll.drag && roll.layout) return roll.layout;
    const { minP, maxP } = pitchSpan();
    roll.layout = { minP, maxP, rowH: (roll.h - CHORD_LANE) / (maxP - minP + 1), xPerTick: roll.w / melody.totalTicks };
    return roll.layout;
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

    // Notes; the part being edited is drawn last, on top, and the others
    // fade back while editing.
    const editing = roll.tool !== 'scroll';
    const indexed = m.parts.map((part, i) => [part, i]);
    indexed.sort((a, b) => (a[0].id === roll.editId) - (b[0].id === roll.editId));
    indexed.forEach(([part, i]) => {
      const rgb = partColor(i);
      const active = part.id === roll.editId;
      const fade = editing && !active ? 0.3 : 1;
      part.notes.forEach((n) => {
        const x = n.tick * L.xPerTick;
        const w = Math.max(2, n.dur * L.xPerTick - 1.5);
        const top = y(n.midi) + 1;
        const h = Math.max(2, L.rowH - 2);
        g.fillStyle = `rgba(${rgb}, ${(0.55 + n.vel * 0.45) * fade})`;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, top, w, h, Math.min(3, h / 2));
        else g.rect(x, top, w, h);
        g.fill();
        if (editing && active) {
          g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
          g.lineWidth = 1;
          g.stroke();
        }
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

  // Scrolls a tall roll so a part's notes are in view.
  function centerRollOn(part) {
    const wrap = roll.canvas.parentElement;
    if (!part || !part.notes.length || wrap.scrollHeight <= wrap.clientHeight) return;
    const L = rollLayout();
    const mid = part.notes.reduce((sum, n) => sum + n.midi, 0) / part.notes.length;
    wrap.scrollTop = Math.max(0, CHORD_LANE + (L.maxP - mid) * L.rowH - wrap.clientHeight / 2);
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

  // | Editing on the roll: Edit adds, moves and resizes notes of the part
  // | picked in the legend; Erase deletes them; Scroll leaves the roll alone
  // | so it scrolls on touch screens.

  function setRollTool(tool) {
    roll.tool = tool;
    document.querySelectorAll('input[name="m-tool"]').forEach((r) => {
      r.checked = r.value === tool;
    });
    roll.canvas.dataset.tool = tool;
    roll.cache = null;
    drawRoll(null);
  }

  function rollPoint(e) {
    const rect = roll.canvas.getBoundingClientRect();
    const L = rollLayout();
    const x = e.clientX - rect.left;
    const yPos = e.clientY - rect.top;
    return {
      x, y: yPos, tick: x / L.xPerTick,
      pitch: Math.round(L.maxP - (yPos - CHORD_LANE - L.rowH / 2) / L.rowH),
      inLane: yPos < CHORD_LANE,
    };
  }

  // The notes array to change for a part: the melody itself for the lead,
  // otherwise the part's own edited copy (made on the first edit).
  function editableNotes(part) {
    if (part.role === 'lead') return melody.notes;
    if (!melody.edits[part.id]) melody.edits[part.id] = part.notes.map((n) => Object.assign({}, n));
    part.notes = melody.edits[part.id];
    return part.notes;
  }

  function hitNote(notes, pt) {
    const L = rollLayout();
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi !== pt.pitch) continue;
      const x0 = n.tick * L.xPerTick;
      const x1 = (n.tick + n.dur) * L.xPerTick;
      if (pt.x >= x0 - 2 && pt.x <= x1 + 2) return { note: n, nearEnd: pt.x > x1 - Math.min(8, (x1 - x0) / 3) };
    }
    return null;
  }

  const snapTick = (t) => Math.round(t / roll.snap) * roll.snap;
  const floorSnap = (t) => Math.floor(t / roll.snap) * roll.snap;

  function rollEdited() {
    roll.cache = null;
    drawRoll(null);
  }

  function deleteNote(notes, note) {
    pushUndo();
    notes.splice(notes.indexOf(note), 1);
    songChanged();
    drawRoll(null);
  }

  function onRollPointerDown(e) {
    if (!melody || roll.tool === 'scroll' || e.button > 0 && e.button !== 2) return;
    const part = editPart();
    if (!part) return;
    const pt = rollPoint(e);
    if (pt.inLane) return;
    e.preventDefault();
    const notes = editableNotes(part);
    const hit = hitNote(notes, pt);
    if (roll.tool === 'erase' || e.button === 2) {
      if (hit) deleteNote(notes, hit.note);
      return;
    }
    pushUndo();
    let note;
    let mode;
    if (hit) {
      note = hit.note;
      mode = hit.nearEnd ? 'resize' : 'move';
    } else {
      const tick = clamp(floorSnap(pt.tick), 0, melody.totalTicks - roll.snap);
      note = { tick, dur: roll.snap, midi: clamp(pt.pitch, 0, 127), vel: 0.8 };
      notes.push(note);
      mode = 'resize';
      previewNote(note, part);
    }
    roll.drag = { note, notes, part, mode, startPt: pt, orig: Object.assign({}, note), moved: !hit };
    roll.canvas.setPointerCapture(e.pointerId);
    rollEdited();
  }

  function onRollPointerMove(e) {
    const pt = rollPoint(e);
    const d = roll.drag;
    if (!d) {
      if (melody && roll.tool === 'edit' && editPart()) {
        const hit = hitNote(editPart().notes, pt);
        roll.canvas.style.cursor = hit ? (hit.nearEnd ? 'ew-resize' : 'grab') : 'crosshair';
      }
      return;
    }
    const n = d.note;
    if (d.mode === 'move') {
      const dt = snapTick(pt.tick - d.startPt.tick);
      const tick = clamp(d.orig.tick + dt, 0, melody.totalTicks - n.dur);
      const midi = clamp(d.orig.midi + (pt.pitch - d.startPt.pitch), 0, 127);
      if (tick !== n.tick || midi !== n.midi) {
        if (midi !== n.midi) previewNote(Object.assign({}, n, { midi }), d.part);
        n.tick = tick;
        n.midi = midi;
        d.moved = true;
      }
    } else {
      const end = clamp(Math.ceil(pt.tick / roll.snap) * roll.snap, n.tick + roll.snap, melody.totalTicks);
      if (end - n.tick !== n.dur) {
        n.dur = end - n.tick;
        d.moved = true;
      }
    }
    rollEdited();
  }

  function onRollPointerUp() {
    const d = roll.drag;
    if (!d) return;
    roll.drag = null;
    if (!d.moved) undoStack.pop();
    $('m-undo').disabled = !undoStack.length;
    d.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    songChanged();
    drawRoll(null);
  }

  // Plays a picked or moved note so you hear what you are placing.
  function previewNote(n, part) {
    if (!audio.ctx || IN_PLUGIN) return;
    resumeAudio();
    playTone(n.midi, audio.ctx.currentTime + 0.01, 0.25, 0.7, INSTRUMENTS[part.instrument].synth, audio.melodyBus);
  }

  function initRollEditing() {
    const c = roll.canvas;
    c.addEventListener('pointerdown', onRollPointerDown);
    c.addEventListener('pointermove', onRollPointerMove);
    c.addEventListener('pointerup', onRollPointerUp);
    c.addEventListener('pointercancel', onRollPointerUp);
    c.addEventListener('contextmenu', (e) => {
      if (roll.tool !== 'scroll') e.preventDefault();
    });
    c.addEventListener('dblclick', (e) => {
      if (!melody || roll.tool !== 'edit' || !editPart()) return;
      const notes = editableNotes(editPart());
      const hit = hitNote(notes, rollPoint(e));
      if (hit) deleteNote(notes, hit.note);
    });
    document.querySelectorAll('input[name="m-tool"]').forEach((r) => {
      r.addEventListener('change', () => setRollTool(r.value));
    });
    $('m-snap').addEventListener('change', (e) => {
      roll.snap = Number(e.target.value);
    });
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    setRollTool(coarse ? 'scroll' : 'edit');
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
    const root = $('m-key-root').value;
    return {
      genre: $('m-genre').value,
      mood: $('m-mood').value,
      bpm: num('m-bpm', 30, 300),
      // 255 is the most a MIDI file can store for beats per bar.
      tsNum: num('m-ts-num', 1, 255),
      tsDen: num('m-ts-den', 1, 9999),
      root: root === '' ? '' : Number(root),
      scale: $('m-key-mode').value,
      length: $('m-length').value,
      rhythm: $('m-rhythm').value,
      instrument: picker.selected[0] || '',
      instruments: genMode === 'ensemble' ? picker.selected.slice() : [],
      mode: genMode,
    };
  }

  // Generator mode, and the picked instruments remembered per mode: one
  // instrument in Melody (the lead) and Chord progression (the chords), any
  // number in Ensemble (in the order they were picked).
  let genMode = 'melody';
  const pickerByMode = { melody: [], chords: [], ensemble: [] };
  const picker = { selected: [] };
  const MAX_ENSEMBLE = 8;

  function renderPicker() {
    $('m-instrument').querySelectorAll('button').forEach((b) => {
      const key = b.dataset.key;
      const on = key === '' ? picker.selected.length === 0 : picker.selected.includes(key);
      b.setAttribute('aria-pressed', String(on));
      const order = picker.selected.indexOf(key);
      b.dataset.order = genMode === 'ensemble' && order >= 0 ? String(order + 1) : '';
    });
    updateInstrumentInfo();
    updateRandomBadges();
  }

  function buildInstrumentPicker() {
    const box = $('m-instrument');
    const entries = [['', 'Random']].concat(Object.keys(INSTRUMENTS).map((k) => [k, INSTRUMENTS[k].name]));
    entries.forEach(([key, name]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inst';
      b.dataset.key = key;
      b.textContent = name;
      if (key) b.title = `${name} · ${rangeLabel(INSTRUMENTS[key])}`;
      b.addEventListener('click', () => pickInstrument(key));
      box.appendChild(b);
    });
    renderPicker();
  }

  function pickInstrument(key) {
    if (key === '') {
      picker.selected = [];
    } else if (genMode === 'ensemble') {
      const i = picker.selected.indexOf(key);
      if (i >= 0) picker.selected.splice(i, 1);
      else if (picker.selected.length < MAX_ENSEMBLE) picker.selected.push(key);
    } else {
      picker.selected = picker.selected[0] === key ? [] : [key];
    }
    renderPicker();
    onInstrumentsChanged();
  }

  function updateInstrumentInfo() {
    const keys = picker.selected;
    let text;
    if (!keys.length) {
      text = genMode === 'ensemble' ? 'Random picks a lead, chords and bass. Pick several instruments to build your own band.' : 'Random picks an instrument that suits the genre and mood.';
    } else if (genMode === 'ensemble') {
      text = ensembleRoles(keys).map((r) => `${INSTRUMENTS[r.instrument].name}: ${PART_NAMES[r.role].toLowerCase()}`).join(' · ');
    } else {
      text = `${INSTRUMENTS[keys[0]].name} · ${rangeLabel(INSTRUMENTS[keys[0]])}`;
    }
    $('m-inst-info').textContent = text;
  }

  // Moves the melody into a new lead instrument's range (whole octaves,
  // folding any stray notes).
  function revoiceLead(key) {
    const [low, high] = INSTRUMENTS[key].range;
    let best = 0;
    let bestScore = Infinity;
    for (let k = -4; k <= 4; k++) {
      const outside = melody.notes.filter((n) => n.midi + 12 * k < low || n.midi + 12 * k > high).length;
      const mid = melody.notes.reduce((sum, n) => sum + n.midi + 12 * k, 0) / Math.max(1, melody.notes.length);
      const score = outside * 100 + Math.abs(mid - (low + high) / 2);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    melody.notes.forEach((n) => {
      n.midi = fitRange(n.midi + 12 * best, key);
    });
    melody.instrument = key;
  }

  // Picking instruments after generating applies them to the current song;
  // Generate writes a new song in their style.
  function onInstrumentsChanged() {
    if (!melody) return;
    const keys = picker.selected;
    if (!keys.length) return;
    if (genMode === 'chords') {
      melody.chordInstrument = keys[0];
    } else if (genMode === 'ensemble') {
      melody.ensemble = keys.slice();
      const lead = ensembleRoles(keys)[0].instrument;
      if (lead !== melody.instrument) revoiceLead(lead);
    } else if (keys[0] !== melody.instrument) {
      revoiceLead(keys[0]);
    }
    songChanged();
  }

  // Updates everything after the song's notes, parts or key changed. A
  // playing song keeps playing from where it is.
  function songChanged() {
    buildParts(melody);
    if (!melody.parts.some((p) => p.id === roll.editId)) roll.editId = melody.parts[0].id;
    roll.cache = null;
    sizeRoll();
    renderRolled();
    renderLegend();
    updateVariationButtons();
    if (mp.playing && !IN_PLUGIN) {
      const built = melodyEvents(melody);
      mp.events = built.events;
      const pos = audio.ctx.currentTime + LOOKAHEAD - mp.loopStart;
      mp.idx = mp.events.findIndex((e) => e.time >= pos);
      if (mp.idx < 0) mp.idx = mp.events.length;
    }
  }

  const MODE_TEXT = {
    melody: { legend: 'Instrument', backing: 'Backing chords', download: 'Melody' },
    chords: { legend: 'Chord instrument', backing: 'Bass line', download: 'Chords' },
    ensemble: { legend: `Instruments (pick up to ${MAX_ENSEMBLE})`, backing: '', download: 'Ensemble' },
  };

  function applyModeUi() {
    const text = MODE_TEXT[genMode];
    $('m-inst-legend').textContent = text.legend;
    $('m-chords-label').textContent = text.backing;
    $('m-chords').closest('.switch').hidden = !text.backing;
    $('m-export').textContent = `${text.download} MIDI`;
    $('m-export-all').textContent = `${text.download} + drums MIDI`;
    $('m-roll').classList.toggle('is-tall', genMode !== 'melody');
    renderPicker();
  }

  // Switching modes keeps the current song: the same chords and melody are
  // re-arranged for the new mode.
  function setMode(mode) {
    if (mode === genMode) return;
    pickerByMode[genMode] = picker.selected.slice();
    genMode = mode;
    picker.selected = pickerByMode[mode].slice();
    applyModeUi();
    if (melody) {
      melody.mode = mode;
      roll.span = null;
      songChanged();
    }
  }

  const PART_COLORS = ['157, 140, 255', '62, 207, 178', '90, 169, 255', '255, 138, 170', '240, 200, 90', '150, 215, 110', '210, 160, 255', '110, 200, 230', '255, 170, 110'];
  const partColor = (i) => PART_COLORS[i % PART_COLORS.length];

  // The legend doubles as the part picker for editing and variations.
  function renderLegend() {
    const box = $('m-legend');
    box.innerHTML = '';
    box.hidden = !melody;
    if (!melody) return;
    melody.parts.forEach((part, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'legend-item';
      b.setAttribute('aria-pressed', String(part.id === roll.editId));
      b.title = 'Edit this part';
      const dot = document.createElement('i');
      dot.style.background = `rgb(${partColor(i)})`;
      b.appendChild(dot);
      b.appendChild(document.createTextNode(`${PART_NAMES[part.role]} · ${INSTRUMENTS[part.instrument].name}`));
      b.addEventListener('click', () => {
        roll.editId = part.id;
        roll.cache = null;
        centerRollOn(part);
        renderLegend();
        updateVariationButtons();
        drawRoll(null);
      });
      box.appendChild(b);
    });
  }

  function updateRandomBadges() {
    document.querySelectorAll('[data-random-field]').forEach((field) => {
      if (field.classList.contains('field-instrument')) {
        field.classList.toggle('is-random', picker.selected.length === 0);
        return;
      }
      const inputs = field.querySelectorAll('input, select');
      field.classList.toggle('is-random', Array.from(inputs).some((el) => el.value === ''));
    });
  }

  function renderRolled() {
    const box = $('m-rolled');
    if (!melody) return;
    box.innerHTML = '';
    const m = melody;
    const r = m.rolled;
    const secs = Math.round(((m.totalTicks * 60) / (m.bpm * TPQ)) * m.tickScale);
    const firstBars = m.chords.slice(0, Math.min(4, m.chords.length));
    const chips = [
      [GENRES[m.genre].name, r.genre],
      [MOODS[m.mood].name, r.mood],
      [`${m.bpm} BPM`, r.bpm],
      [`${m.num}/${m.den}`, r.meter],
      [`${NOTE_NAMES[m.root]} ${SCALES[m.scale].name}`, r.root || r.scale],
      [`${m.bars} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, r.length],
      [RHYTHMS[m.rhythm] + (m.swing ? ' (swung)' : ''), r.rhythm],
      [firstBars.map((c) => (m.mode === 'melody' ? c.name : `${c.name} (${romanNumeral(m, c)})`)).join(' – '), false],
    ];
    chips.forEach(([text, rolled]) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (rolled ? ' is-random' : '');
      chip.textContent = text;
      if (rolled) chip.title = 'Picked at random';
      box.appendChild(chip);
    });
  }

  function generate() {
    melody = generateMelody(readMelodyInput());
    undoStack.length = 0;
    roll.editId = 'lead';
    roll.span = null;
    roll.canvas.parentElement.scrollLeft = 0;
    $('m-play').disabled = false;
    $('m-export').disabled = false;
    $('m-export-all').disabled = false;
    $('m-edit-tools').hidden = false;
    roll.canvas.setAttribute('aria-label', `Piano roll over ${melody.bars} bars, chords ${melody.chords.map((c) => c.name).join(', ')}`);
    const wasPlaying = mp.playing;
    songChanged();
    centerRollOn(melody.parts[0]);
    if (wasPlaying) {
      // Swap the new song in on the next downbeat.
      const now = audio.ctx.currentTime + 0.05;
      const drumBeat = nextDrumDownbeat();
      startMelody(drumBeat !== null ? drumBeat : now);
    } else {
      drawRoll(null);
    }
  }

  function resetMelodyControls() {
    $('melody-form').reset();
    picker.selected = [];
    renderPicker();
  }

  // ---------------------------------------------------------------------
  // | Editing and variations                                            |
  // ---------------------------------------------------------------------

  const undoStack = [];

  function snapshot() {
    return JSON.stringify({ notes: melody.notes, edits: melody.edits, root: melody.root, chords: melody.chords });
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 60) undoStack.shift();
    $('m-undo').disabled = false;
  }

  function undo() {
    if (!melody || !undoStack.length) return;
    const prev = JSON.parse(undoStack.pop());
    melody.notes = prev.notes;
    melody.edits = prev.edits;
    melody.root = prev.root;
    melody.chords = prev.chords;
    $('m-undo').disabled = !undoStack.length;
    songChanged();
    drawRoll(null);
  }

  const editPart = () => melody && melody.parts.find((p) => p.id === roll.editId);

  // Stores new notes for the part being edited: the lead is the melody
  // itself; other parts keep their own edited copy.
  function setPartNotes(part, notes) {
    notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    if (part.role === 'lead') {
      melody.notes.length = 0;
      notes.forEach((n) => melody.notes.push(n));
    } else {
      melody.edits[part.id] = notes;
    }
  }

  const isChordal = (part) => ['chords', 'arp', 'pad'].includes(part.role) && isKind(part.instrument, 'poly');

  // Notes that start together, as groups (chords) in time order.
  function noteGroups(notes) {
    const byTick = new Map();
    notes.forEach((n) => {
      if (!byTick.has(n.tick)) byTick.set(n.tick, []);
      byTick.get(n.tick).push(n);
    });
    return Array.from(byTick.entries()).sort((a, b) => a[0] - b[0]).map(([tick, ns]) => ({ tick, dur: Math.max(...ns.map((n) => n.dur)), notes: ns }));
  }

  const flatten = (groups) => [].concat(...groups.map((g) => g.notes.map((n) => Object.assign({}, n, { tick: g.tick, dur: g.dur }))));

  function pitchContext(part) {
    const steps = SCALES[melody.scale].steps;
    const n = steps.length;
    const [low, high] = INSTRUMENTS[part.instrument].range;
    let lo = midiToIdx(melody, low);
    let hi = midiToIdx(melody, high);
    if (idxToMidiOf(melody, lo) < low) lo++;
    if (idxToMidiOf(melody, hi) > high) hi--;
    const center = midiToIdx(melody, Math.round((low + high) / 2));
    return {
      root: melody.root, steps, n, lo, hi, center, span: Math.max(1, (hi - lo) / 2), tonicMidi: melody.root,
      leap: GENRES[melody.genre].leap, pattern: melody.rhythm, strongSet: new Set(groupStarts(melody.groups)),
    };
  }

  const barOf = (tick) => Math.min(melody.chords.length - 1, Math.floor(tick / melody.barTicks));

  // Each variation takes the part's notes and returns new ones.
  const VARIATIONS = {
    mutate: { label: 'Mutate', melodic: true, run(notes, part) {
      const ctx = pitchContext(part);
      const out = [];
      notes.forEach((n) => {
        if (!chance(0.25)) return out.push(Object.assign({}, n));
        const op = pick(['step', 'step', 'split', 'merge']);
        if (op === 'split' && n.dur >= 24 && n.dur % 2 === 0) {
          const idx = midiToIdx(melody, n.midi);
          out.push(Object.assign({}, n, { dur: n.dur / 2 }));
          out.push(Object.assign({}, n, { tick: n.tick + n.dur / 2, dur: n.dur / 2, midi: idxToMidiOf(melody, clamp(idx + pick([-1, 1]), ctx.lo, ctx.hi)) }));
        } else if (op === 'merge' && out.length) {
          const prev = out[out.length - 1];
          prev.dur = n.tick + n.dur - prev.tick;
        } else {
          const idx = clamp(midiToIdx(melody, n.midi) + pick([-2, -1, 1, 2]), ctx.lo, ctx.hi);
          out.push(Object.assign({}, n, { midi: idxToMidiOf(melody, idx) }));
        }
        return null;
      });
      return out;
    } },
    rhythm: { label: 'New rhythm', run(notes) {
      const groups = noteGroups(notes);
      const ctx = { groups: melody.groups, barTicks: melody.barTicks, strongSet: new Set(groupStarts(melody.groups)), pattern: melody.rhythm, restProb: 0.06, arpUnit: 24 };
      const out = [];
      let lastSets = [groups.length ? groups[0].notes : []];
      for (let bar = 0; bar < melody.bars; bar++) {
        const inBar = groups.filter((g) => barOf(g.tick) === bar).map((g) => g.notes);
        const sets = inBar.length ? inBar : lastSets;
        lastSets = sets;
        let i = 0;
        makeBarRhythm(ctx).forEach((it) => {
          if (it.rest) return;
          sets[i % sets.length].forEach((n) => out.push(Object.assign({}, n, { tick: bar * melody.barTicks + it.start, dur: it.dur })));
          i++;
        });
      }
      return out;
    } },
    pitches: { label: 'New notes', melodic: true, run(notes, part) {
      const ctx = pitchContext(part);
      const state = { prev: ctx.center, lastMove: 0, dir: 1 };
      return notes.map((n) => {
        const strong = ctx.strongSet.has(n.tick % melody.barTicks);
        const idx = commit(state, choosePitch(ctx, state, melody.chords[barOf(n.tick)].pcs, strong));
        return Object.assign({}, n, { midi: idxToMidiOf(melody, idx) });
      });
    } },
    simplify: { label: 'Simplify', run(notes) {
      const strong = new Set(groupStarts(melody.groups));
      const groups = noteGroups(notes);
      const kept = groups.filter((g, i) => i === 0 || strong.has(g.tick % melody.barTicks) || chance(0.4));
      kept.forEach((g, i) => {
        const next = kept[i + 1];
        const barEnd = (barOf(g.tick) + 1) * melody.barTicks;
        g.dur = Math.max(g.dur, Math.min(next ? next.tick : melody.totalTicks, barEnd) - g.tick);
      });
      return flatten(kept);
    } },
    embellish: { label: 'Embellish', melodic: true, run(notes, part) {
      const ctx = pitchContext(part);
      const out = [];
      notes.forEach((n, i) => {
        const next = notes[i + 1];
        const a = midiToIdx(melody, n.midi);
        if (next && n.dur >= 24 && n.dur % 2 === 0 && Math.abs(midiToIdx(melody, next.midi) - a) >= 2) {
          const dir = Math.sign(midiToIdx(melody, next.midi) - a);
          out.push(Object.assign({}, n, { dur: n.dur / 2 }));
          out.push(Object.assign({}, n, { tick: n.tick + n.dur / 2, dur: n.dur / 2, vel: n.vel * 0.85, midi: idxToMidiOf(melody, clamp(a + dir, ctx.lo, ctx.hi)) }));
        } else {
          out.push(Object.assign({}, n));
        }
      });
      return out;
    } },
    reverse: { label: 'Reverse', run(notes) {
      return noteGroups(notes).map((g) => ({ tick: melody.totalTicks - (g.tick + g.dur), dur: g.dur, notes: g.notes }))
        .reduce((all, g) => all.concat(g.notes.map((n) => Object.assign({}, n, { tick: Math.max(0, g.tick), dur: g.dur }))), []);
    } },
    invert: { label: 'Invert', melodic: true, run(notes, part) {
      const ctx = pitchContext(part);
      const idxs = notes.map((n) => midiToIdx(melody, n.midi)).sort((a, b) => a - b);
      const mid = idxs[Math.floor(idxs.length / 2)] || 0;
      return notes.map((n) => Object.assign({}, n, { midi: fitRange(idxToMidiOf(melody, clamp(2 * mid - midiToIdx(melody, n.midi), ctx.lo - 7, ctx.hi + 7)), part.instrument) }));
    } },
    humanize: { label: 'Humanize', run(notes) {
      return notes.map((n) => Object.assign({}, n, { vel: clamp(n.vel * (0.85 + Math.random() * 0.3), 0.2, 1) }));
    } },
    legato: { label: 'Legato', run(notes) {
      const groups = noteGroups(notes);
      groups.forEach((g, i) => {
        g.dur = (groups[i + 1] ? groups[i + 1].tick : melody.totalTicks) - g.tick;
      });
      return flatten(groups);
    } },
    staccato: { label: 'Staccato', run(notes) {
      return notes.map((n) => Object.assign({}, n, { dur: Math.max(6, Math.round(n.dur * 0.45)) }));
    } },
    octDown: { label: 'Oct −', run(notes) {
      return notes.map((n) => Object.assign({}, n, { midi: Math.max(0, n.midi - 12) }));
    } },
    octUp: { label: 'Oct +', run(notes) {
      return notes.map((n) => Object.assign({}, n, { midi: Math.min(127, n.midi + 12) }));
    } },
  };

  function applyVariation(key) {
    const part = editPart();
    if (!part) return;
    const v = VARIATIONS[key];
    if (v.melodic && isChordal(part)) return;
    pushUndo();
    setPartNotes(part, v.run(part.notes.map((n) => Object.assign({}, n)), part));
    songChanged();
    drawRoll(null);
  }

  // Moves the whole song up or down a semitone: key, chords and every part.
  function transposeSong(semitones) {
    if (!melody) return;
    pushUndo();
    melody.root = mod(melody.root + semitones, 12);
    melody.chords.forEach((c) => {
      c.pcs = c.pcs.map((pc) => mod(pc + semitones, 12));
      c.name = chordName(c.pcs);
    });
    melody.notes.forEach((n) => {
      n.midi += semitones;
    });
    Object.keys(melody.edits).forEach((id) => melody.edits[id].forEach((n) => {
      n.midi += semitones;
    }));
    songChanged();
    drawRoll(null);
  }

  function buildVariationButtons() {
    const box = $('m-variations');
    Object.keys(VARIATIONS).forEach((key) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-xs';
      b.dataset.variation = key;
      b.textContent = VARIATIONS[key].label;
      b.addEventListener('click', () => applyVariation(key));
      box.appendChild(b);
    });
    [['Key −', -1], ['Key +', 1]].forEach(([label, st]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-xs';
      b.textContent = label;
      b.title = 'Transpose the whole song';
      b.addEventListener('click', () => transposeSong(st));
      box.appendChild(b);
    });
  }

  function updateVariationButtons() {
    const part = editPart();
    document.querySelectorAll('#m-variations [data-variation]').forEach((b) => {
      const melodicOnly = VARIATIONS[b.dataset.variation].melodic;
      b.disabled = !part || (melodicOnly && isChordal(part));
      b.title = b.disabled && part ? 'Works on melody lines (pick a melodic part in the legend)' : `Apply to ${part ? PART_NAMES[part.role].toLowerCase() : 'the selected part'}`;
    });
  }

  // ---------------------------------------------------------------------
  // | UI: drums                                                         |
  // ---------------------------------------------------------------------

  let stepEls = [];

  function renderGrid() {
    const grid = $('d-grid');
    const steps = stepCount();
    const groupSize = stepsPerBeat();
    const rows = currentRows();
    grid.innerHTML = '';
    grid.classList.toggle('triplet', drum.triplet);
    grid.className = grid.className.replace(/\bspb-\d+\b/g, '').trim() + ` spb-${groupSize}`;
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
        const subLabels = { 2: ['', '&'], 3: ['', 'trip', 'let'], 4: ['', 'e', '&', 'a'] }[groupSize] || [];
        num.textContent = s === 0 ? String(gi + 1) : (subLabels[s] || '');
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
    const grid = drum.triplet ? `triplets (${stepCount()} steps per cycle)` : `${stepsPerBeat()} step${stepsPerBeat() > 1 ? 's' : ''} per beat (${stepCount()} per cycle)`;
    const span = { half: 'two bars', normal: 'one bar', double: 'half a bar' }[drum.feel];
    $('d-feel-info').textContent = `${FEEL_NAMES[drum.feel]} · ${grid} · one cycle = ${span} of ${drum.num}/${drum.den} at ${drum.bpm} BPM` +
      (drum.feel === 'normal' ? '' : ` (feels like ${perceived} BPM)`);
  }

  function syncDrumControls() {
    $('d-preset').value = drum.preset;
    $('d-bpm').value = drum.bpm;
    $('d-bpm-range').value = drum.bpm;
    $('d-kit').value = drum.kit;
    $('d-swing').value = drum.swing;
    $('d-swing-out').textContent = `${drum.swing}%`;
    $('d-swing').disabled = !canSwing();
    $('d-ts-num').value = drum.num;
    $('d-ts-den').value = drum.den;
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
    const off = (s) => stepsPerBeat() === 1 || s % stepsPerBeat() !== 0;
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

  // | Views: the generator and the drum machine share the page as tabs.

  const VIEW_KEY = 'mds-view';

  function setView(view, focus) {
    document.querySelectorAll('.view-tab').forEach((tab) => {
      const on = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    $('view-melody').hidden = view !== 'melody';
    $('view-drums').hidden = view !== 'drums';
    // The roll measures its box, which is empty while hidden.
    if (view === 'melody') sizeRoll();
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Private mode or blocked storage: the view just isn't remembered.
    }
  }

  function initViews() {
    const tabs = Array.from(document.querySelectorAll('.view-tab'));
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => setView(tab.dataset.view));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setView(tabs[(i + 1) % tabs.length].dataset.view, true);
      });
    });
    let saved = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {
      // Storage blocked: start on the generator.
    }
    setView(saved === 'drums' ? 'drums' : 'melody');
  }

  function updatePlayButtons() {
    const mBtn = $('m-play');
    mBtn.textContent = mp.playing ? 'Stop' : 'Play';
    mBtn.classList.toggle('is-active', mp.playing);
    const dBtn = $('d-play');
    dBtn.textContent = dp.playing ? 'Stop' : 'Play';
    dBtn.classList.toggle('is-active', dp.playing);
    $('tab-melody').classList.toggle('is-playing', mp.playing);
    $('tab-drums').classList.toggle('is-playing', dp.playing);
    const all = mp.playing && dp.playing;
    $('play-all').textContent = all ? 'Restart all' : 'Play all';
    const active = mp.playing || dp.playing;
    setMediaSession(active);
    setWakeLock(active);
  }

  // Keeps a phone screen awake while music is playing.
  let wakeLock = null;

  function setWakeLock(on) {
    if (IN_PLUGIN || !('wakeLock' in navigator)) return;
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
  // | Plugin bridge                                                     |
  // ---------------------------------------------------------------------

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  // Messages go to the plugin as ASCII-only JSON in small chunks: JUCE's
  // Linux web view drops messages that are large or contain multi-byte
  // characters, and chunking costs nothing elsewhere.
  const CHUNK_SIZE = 3000;

  function sendToPlugin(message) {
    const json = JSON.stringify(message).replace(/[\u007f-\uffff]/g, (c) => `\\u${(`000${c.charCodeAt(0).toString(16)}`).slice(-4)}`);
    const count = Math.max(1, Math.ceil(json.length / CHUNK_SIZE));
    plugin.messageId++;
    for (let i = 0; i < count; i++) {
      juceBackend.emitEvent('studio', { type: 'chunk', id: plugin.messageId, i, n: count, data: json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
    }
  }

  const r4 = (x) => Math.round(x * 10000) / 10000;
  const plugin = { lastSig: '', timer: null, messageId: 0, restoreParts: [], pos: { q: 0, playing: false, host: false, bpm: 120 }, songLoopQ: 0, drumLoopQ: 0, stepQ: 0.25 };

  // The song as note events in quarter notes, ready for the plugin to play
  // in sync with the DAW: [start, length, note, velocity, synth, channel].
  function pluginSong() {
    if (!melody) return { loopQ: 0, events: [] };
    const built = melodyEvents(melody);
    const toQ = melody.bpm / 60;
    const events = [];
    built.events.forEach((e) => {
      const q = r4(e.time * toQ);
      if (e.type === 'note') {
        if (e.role === 'bass' && melody.mode === 'chords' && !$('m-chords').checked) return;
        events.push([q, r4(e.dur * toQ), e.midi, r4(e.vel), e.synth, e.channel]);
      } else if ($('m-chords').checked) {
        const backingChannel = partChannel(melody.parts.length);
        const c = e.chord;
        const len = e.dur * toQ;
        const base = 48 + c.pcs[0];
        c.pcs.forEach((pc) => {
          let n = 48 + pc;
          while (n < base) n += 12;
          events.push([q, r4(len * 0.96), n, 0.6, 'backing', backingChannel]);
        });
        if (!isKind(melody.instrument, 'bass')) events.push([q, r4(len * 0.9), 36 + c.pcs[0], 0.8, 'backingBass', backingChannel]);
      }
    });
    return { loopQ: r4(built.loopDur * toQ), events };
  }

  // One drum loop as hits in quarter notes: [start, drum index, velocity].
  function pluginDrums() {
    const rows = currentRows();
    const steps = stepCount();
    const stepQ = ((4 / drum.den) / stepsPerBeat()) * FEELS[drum.feel];
    const hits = [];
    for (let st = 0; st < steps; st++) {
      let q = st * stepQ;
      if (canSwing() && st % 2 === 1) q += (stepQ * drum.swing) / 300;
      DRUMS.forEach((d, i) => {
        const v = rows[d.id][st];
        if (v && !drum.muted.has(d.id)) hits.push([r4(q), i, v === 2 ? 1 : 0.6]);
      });
    }
    return { loopQ: r4(steps * stepQ), stepQ, hits };
  }

  // Everything the page needs to come back as it was when the DAW project
  // is reopened.
  function exportSession() {
    const form = {};
    document.querySelectorAll('#melody-form input, #melody-form select').forEach((el) => {
      if (el.id) form[el.id] = el.value;
    });
    pickerByMode[genMode] = picker.selected.slice();
    return {
      v: 1,
      melody,
      mode: genMode,
      pickerByMode,
      form,
      loop: $('m-loop').checked,
      backing: $('m-chords').checked,
      volumes: { master: $('master-volume').value, melody: $('m-volume').value, drums: $('d-volume').value },
      drum: {
        preset: drum.preset, bpm: drum.bpm, num: drum.num, den: drum.den, feel: drum.feel, triplet: drum.triplet,
        swing: drum.swing, humanize: drum.humanize, kit: drum.kit, straight: drum.straight, trip: drum.trip,
        stale: drum.stale, source: drum.source, muted: Array.from(drum.muted),
      },
    };
  }

  function importSession(sess) {
    if (!sess || sess.v !== 1) return;
    Object.keys(sess.form || {}).forEach((id) => {
      if ($(id)) $(id).value = sess.form[id];
    });
    Object.assign(pickerByMode, sess.pickerByMode || {});
    genMode = sess.mode || 'melody';
    document.querySelectorAll('input[name="m-mode"]').forEach((r) => {
      r.checked = r.value === genMode;
    });
    Object.keys(pickerByMode).forEach((k) => {
      if (!Array.isArray(pickerByMode[k])) pickerByMode[k] = pickerByMode[k] ? [pickerByMode[k]] : [];
    });
    picker.selected = pickerByMode[genMode].slice();
    $('m-loop').checked = sess.loop !== false;
    $('m-chords').checked = sess.backing !== false;
    if (sess.volumes) {
      $('master-volume').value = sess.volumes.master;
      $('m-volume').value = sess.volumes.melody;
      $('d-volume').value = sess.volumes.drums;
    }
    if (sess.drum) {
      Object.assign(drum, sess.drum, { muted: new Set(sess.drum.muted || []) });
      syncDrumControls();
      renderGrid();
    }
    applyModeUi();
    updateRandomBadges();
    if (sess.melody) {
      melody = sess.melody;
      melody.edits = melody.edits || {};
      $('m-play').disabled = false;
      $('m-export').disabled = false;
      $('m-export-all').disabled = false;
      $('m-edit-tools').hidden = false;
      roll.editId = 'lead';
      roll.span = null;
      songChanged();
    }
    pushPluginState(true);
  }

  // Sends the current song, drum loop and settings to the plugin whenever
  // anything changed (checked a few times a second).
  function pushPluginState(force) {
    if (!IN_PLUGIN) return;
    const song = pluginSong();
    const drums = pluginDrums();
    const state = {
      song,
      drums: { loopQ: drums.loopQ, hits: drums.hits },
      loop: $('m-loop').checked,
      previewSong: mp.playing && !!melody,
      previewDrums: dp.playing,
      previewBpm: mp.playing && melody ? melody.bpm : drum.bpm,
      kit: Object.keys(KITS).indexOf(drum.kit),
      humanize: drum.humanize,
      master: Number($('master-volume').value),
      songGain: Number($('m-volume').value),
      drumGain: Number($('d-volume').value),
    };
    const sig = JSON.stringify(state);
    if (!force && sig === plugin.lastSig) return;
    plugin.lastSig = sig;
    plugin.songLoopQ = song.loopQ;
    plugin.drumLoopQ = drums.loopQ;
    plugin.stepQ = drums.stepQ;
    const midiSong = melody ? songMidi(true) : null;
    const midiDrums = drumsMidi();
    // The sounds the song uses, so the plugin's synth matches the browser's.
    const patches = {};
    song.events.forEach((e) => {
      if (!patches[e[4]]) patches[e[4]] = patchFor(e[4]);
    });
    sendToPlugin(Object.assign({ type: 'state' }, state, {
      patches,
      midiSong: midiSong ? { name: midiSong.name, data: toBase64(midiSong.bytes) } : null,
      midiDrums: { name: midiDrums.name, data: toBase64(midiDrums.bytes) },
      session: JSON.stringify(exportSession()),
    }));
  }

  // Playhead and drum-step display driven by the plugin's position reports.
  function pluginDraw() {
    requestAnimationFrame(pluginDraw);
    const p = plugin.pos;
    const songOn = p.playing && melody && plugin.songLoopQ > 0 && (p.host || mp.playing);
    if (songOn) {
      const loopOn = $('m-loop').checked;
      const q = loopOn ? mod(p.q, plugin.songLoopQ) : p.q;
      drawRoll(q >= 0 && q <= plugin.songLoopQ ? q / plugin.songLoopQ : null);
      plugin.drewSong = true;
    } else if (plugin.drewSong) {
      drawRoll(null);
      plugin.drewSong = false;
    }
    const drumsOn = p.playing && plugin.drumLoopQ > 0 && (p.host || dp.playing);
    showStep(drumsOn ? Math.floor(mod(p.q, plugin.drumLoopQ) / plugin.stepQ) % stepCount() : -1);
  }

  function initPlugin() {
    document.documentElement.classList.add('in-plugin');
    const status = document.createElement('span');
    status.className = 'host-status';
    status.id = 'host-status';
    status.textContent = 'Plugin · waiting for the DAW';
    $('play-all').parentElement.insertBefore(status, $('play-all'));
    juceBackend.addEventListener('position', (p) => {
      plugin.pos = p;
      status.textContent = p.host ?
        `DAW ${p.playing ? 'playing' : 'stopped'} · ${Math.round(p.bpm * 10) / 10} BPM` :
        (p.playing ? `Previewing · ${Math.round(p.bpm)} BPM` : 'DAW stopped · press Play in your DAW or preview here');
    });
    // The saved session arrives in chunks, like everything else.
    juceBackend.addEventListener('restoreChunk', (part) => {
      if (part.i === 0) plugin.restoreParts = [];
      plugin.restoreParts[part.i] = part.data;
      if (plugin.restoreParts.filter((x) => x !== undefined).length !== part.n) return;
      try {
        importSession(JSON.parse(plugin.restoreParts.join('')));
      } catch {
        // A session from an incompatible version: start fresh.
      }
      plugin.restoreParts = [];
    });
    plugin.timer = setInterval(() => pushPluginState(false), 250);
    requestAnimationFrame(pluginDraw);
    sendToPlugin({ type: 'ready' });
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
    buildVariationButtons();
    document.querySelectorAll('input[name="m-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => setMode(radio.value));
    });
    applyModeUi();
    fillSelect($('d-preset'), Object.keys(PRESETS).map((k) => [k, PRESETS[k].name]));
    fillSelect($('d-kit'), Object.keys(KITS).map((k) => [k, KITS[k].name]));

    roll.canvas = $('m-roll');
    roll.ctx = roll.canvas.getContext('2d');
    initRollEditing();
    initViews();
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
    $('m-undo').addEventListener('click', undo);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        undo();
      }
    });
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
    const onDrumMeter = () => {
      if (setDrumMeter(Number($('d-ts-num').value), Number($('d-ts-den').value))) renderGrid();
      syncDrumControls();
    };
    $('d-ts-num').addEventListener('change', onDrumMeter);
    $('d-ts-den').addEventListener('change', onDrumMeter);
    $('d-sync').addEventListener('click', () => {
      if (!melody) return;
      setDrumBpm(melody.bpm);
      if (setDrumMeter(melody.num, melody.den)) renderGrid();
      syncDrumControls();
    });
    $('d-vary').addEventListener('click', addVariation);
    $('d-clear').addEventListener('click', () => {
      if (drum.triplet) drum.trip = emptyRows(stepCount());
      else drum.straight = emptyRows(stepCount());
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
      if (setDrumMeter(melody.num, melody.den)) renderGrid();
      syncDrumControls();
      const at = audio.ctx.currentTime + 0.1;
      startMelody(at);
      startDrums(at);
    });
    $('stop-all').addEventListener('click', () => {
      stopMelody();
      stopDrums();
      drawRoll(null);
    });

    if (IN_PLUGIN) initPlugin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
