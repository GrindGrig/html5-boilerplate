#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cstdint>

namespace studio
{

// Synth voices for the song parts and synthesized drums, mirroring the
// sounds of the browser version (Web Audio) closely enough to sound alike.
class SoundEngine
{
public:
    static constexpr int numDrums = 12;

    // Index of a synth patch by the name the web app uses ("piano", "sax", ...),
    // or -1 if unknown.
    static int patchIndex (const juce::String& name);

    void prepare (double sampleRate);
    void reset();

    // Starts a note `delay` samples into the next render call; it releases
    // after `gate` samples.
    void noteOn (int patch, int midiNote, float velocity, int delay, int gate);

    // Fires drum `type` (0..11, the web app's order) `delay` samples ahead.
    void drumHit (int type, float velocity, int delay, int kit);

    // Releases every sounding note (transport stop or jump).
    void releaseAll();

    void render (juce::AudioBuffer<float>& buffer, int numSamples, float songGain, float drumGain, float master, int kit);

private:
    enum class Wave { sine, saw, square, triangle };

    struct Patch
    {
        Wave wave1 = Wave::saw, wave2 = Wave::saw;
        float mix2 = 0.0f, ratio2 = 1.0f, detune2 = 0.0f; // second oscillator: level, frequency ratio, cents
        float partialDecay = 0.0f;                         // seconds for osc 2 to fade (0 = steady)
        float attack = 0.01f, decay = 0.3f, sustain = 0.7f, release = 0.15f;
        float cutoffMul = 100.0f, cutoffMax = 16000.0f;    // lowpass at note frequency * cutoffMul
        float envAmount = 0.0f, envTime = 0.2f, q = 0.7f;  // cutoff sweep: * (1 + envAmount * e^(-t/envTime))
        float vibCents = 0.0f, vibRate = 5.0f, vibDelay = 0.2f;
        float drive = 0.0f, noise = 0.0f;
        float fmRatio = 0.0f, fmIndex = 0.0f, fmDecay = 1.0f;
        float level = 0.15f;
    };

    struct Envelope
    {
        enum Stage { idle, attack, decay, sustain, release };
        Stage stage = idle;
        float value = 0.0f, attackStep = 0.0f, decayCoef = 0.0f, releaseCoef = 0.0f, sustainLevel = 0.0f;
        void start (const Patch& p, double sr);
        void noteOff() { if (stage != idle) stage = release; }
        float next();
    };

    struct Filter // TPT state-variable lowpass
    {
        float ic1 = 0.0f, ic2 = 0.0f, g = 0.5f, k = 1.4f;
        void set (float cutoff, float q, double sr);
        float lowpass (float x);
        float bandpass (float x);
    };

    struct Voice
    {
        bool active = false;
        const Patch* patch = nullptr;
        int note = 0, delay = 0, gate = 0;
        float velocity = 0.0f;
        double freq = 440.0, phase1 = 0.0, phase2 = 0.0, phaseMod = 0.0, vibPhase = 0.0, time = 0.0;
        uint32_t age = 0;
        Envelope env;
        Filter filter;
        int filterCounter = 0;
    };

    struct DrumVoice
    {
        bool active = false;
        int type = 0, delay = 0;
        float velocity = 0.0f;
        double time = 0.0, phase1 = 0.0, phase2 = 0.0;
        float env1 = 0.0f, env2 = 0.0f, coef1 = 0.0f, coef2 = 0.0f;
        float hpState = 0.0f, hpPrev = 0.0f;
        Filter filter;
    };

    struct Kit { float kickPitch, kickEnd, kickDecay, snareTone, snareDecay, hatDecay, filter; };

    static const Patch& patch (int index);
    static const Kit& kitParams (int kit);

    float renderVoice (Voice& v);
    float renderDrum (DrumVoice& d, const Kit& kit);
    float noise();

    double sr = 44100.0;
    std::array<Voice, 48> voices;
    std::array<DrumVoice, 32> drums;
    uint32_t ageCounter = 0, rng = 0x9e3779b9u;
    Filter drumBusL, drumBusR;
    juce::Reverb reverb;
    juce::AudioBuffer<float> songBus;
};

} // namespace studio
