#include "SoundEngine.h"

#include <cmath>

namespace studio
{

namespace
{
    constexpr double twoPi = juce::MathConstants<double>::twoPi;

    // Coefficient that takes an exponential decay to -80 dB in `seconds`
    // (the shape of Web Audio's exponentialRampToValueAtTime(0.0001)).
    float decayCoef (float seconds, double sr)
    {
        return (float) std::exp (-9.21 / (juce::jmax (0.001f, seconds) * sr));
    }

    float polyBlep (double t, double dt)
    {
        if (t < dt)       { t /= dt; return (float) (t + t - t * t - 1.0); }
        if (t > 1.0 - dt) { t = (t - 1.0) / dt; return (float) (t * t + t + t + 1.0); }
        return 0.0f;
    }

    const char* const patchNames[] = {
        "piano", "keys", "pluck", "eguitar", "bass", "violin", "cello", "flute",
        "sax", "trumpet", "marimba", "lead", "pad", "bell", "backing", "backingBass"
    };
}

//==============================================================================
int SoundEngine::patchIndex (const juce::String& name)
{
    for (int i = 0; i < (int) std::size (patchNames); ++i)
        if (name == patchNames[i])
            return i;
    return -1;
}

const SoundEngine::Patch& SoundEngine::patch (int index)
{
    static const std::array<Patch, 16> patches = []
    {
        std::array<Patch, 16> p {};
        auto& piano = p[0];
        piano.wave1 = Wave::triangle; piano.wave2 = Wave::sine; piano.mix2 = 0.35f; piano.ratio2 = 2.0f; piano.partialDecay = 0.6f;
        piano.attack = 0.003f; piano.decay = 1.8f; piano.sustain = 0.02f; piano.release = 0.25f;
        piano.cutoffMul = 3.0f; piano.envAmount = 3.0f; piano.envTime = 0.35f; piano.level = 0.3f;

        auto& keys = p[1];
        keys.wave1 = Wave::sine; keys.wave2 = Wave::triangle; keys.mix2 = 0.35f; keys.ratio2 = 2.0f; keys.partialDecay = 0.4f;
        keys.attack = 0.005f; keys.decay = 1.2f; keys.sustain = 0.3f; keys.release = 0.3f; keys.level = 0.28f;

        auto& pluck = p[2];
        pluck.wave1 = Wave::saw; pluck.wave2 = Wave::triangle; pluck.mix2 = 0.5f; pluck.ratio2 = 2.0f; pluck.detune2 = -5.0f;
        pluck.attack = 0.004f; pluck.decay = 0.35f; pluck.sustain = 0.15f; pluck.release = 0.15f;
        pluck.cutoffMul = 1.5f; pluck.envAmount = 6.0f; pluck.envTime = 0.12f; pluck.q = 1.4f; pluck.level = 0.22f;

        auto& eguitar = p[3];
        eguitar.wave1 = Wave::saw; eguitar.wave2 = Wave::square; eguitar.mix2 = 0.8f; eguitar.detune2 = 5.0f; eguitar.drive = 3.0f;
        eguitar.attack = 0.005f; eguitar.decay = 0.3f; eguitar.sustain = 0.6f; eguitar.release = 0.15f;
        eguitar.cutoffMax = 2800.0f; eguitar.q = 1.0f; eguitar.level = 0.1f;

        auto& bass = p[4];
        bass.wave1 = Wave::sine; bass.wave2 = Wave::saw; bass.mix2 = 0.6f;
        bass.attack = 0.005f; bass.decay = 0.3f; bass.sustain = 0.6f; bass.release = 0.08f;
        bass.cutoffMul = 3.0f; bass.cutoffMax = 1600.0f; bass.envAmount = 1.5f; bass.envTime = 0.1f; bass.q = 2.0f; bass.level = 0.38f;

        auto& violin = p[5];
        violin.wave1 = Wave::saw; violin.wave2 = Wave::saw; violin.mix2 = 1.0f; violin.detune2 = 9.0f;
        violin.attack = 0.08f; violin.decay = 0.2f; violin.sustain = 0.85f; violin.release = 0.2f;
        violin.cutoffMax = 3800.0f; violin.vibCents = 12.0f; violin.vibRate = 5.6f; violin.vibDelay = 0.25f; violin.level = 0.12f;

        auto& cello = p[6];
        cello = violin;
        cello.attack = 0.1f; cello.cutoffMax = 2000.0f; cello.vibCents = 10.0f; cello.vibRate = 5.0f; cello.level = 0.16f;

        auto& flute = p[7];
        flute.wave1 = Wave::sine; flute.wave2 = Wave::triangle; flute.mix2 = 0.25f; flute.noise = 0.05f;
        flute.attack = 0.06f; flute.decay = 0.1f; flute.sustain = 0.9f; flute.release = 0.12f;
        flute.cutoffMul = 4.0f; flute.vibCents = 8.0f; flute.vibRate = 5.0f; flute.vibDelay = 0.2f; flute.level = 0.2f;

        auto& sax = p[8];
        sax.wave1 = Wave::square; sax.wave2 = Wave::saw; sax.mix2 = 1.0f; sax.detune2 = 6.0f;
        sax.attack = 0.03f; sax.decay = 0.15f; sax.sustain = 0.8f; sax.release = 0.1f;
        sax.cutoffMul = 5.0f; sax.cutoffMax = 6000.0f; sax.envAmount = -0.6f; sax.envTime = 0.03f; sax.q = 3.0f;
        sax.vibCents = 10.0f; sax.vibRate = 5.0f; sax.vibDelay = 0.3f; sax.level = 0.12f;

        auto& trumpet = p[9];
        trumpet.wave1 = Wave::saw; trumpet.wave2 = Wave::saw; trumpet.mix2 = 1.0f; trumpet.detune2 = 7.0f;
        trumpet.attack = 0.025f; trumpet.decay = 0.15f; trumpet.sustain = 0.8f; trumpet.release = 0.08f;
        trumpet.cutoffMul = 4.0f; trumpet.cutoffMax = 7000.0f; trumpet.envAmount = -0.6f; trumpet.envTime = 0.03f; trumpet.q = 2.0f;
        trumpet.vibCents = 6.0f; trumpet.vibRate = 5.5f; trumpet.vibDelay = 0.3f; trumpet.level = 0.12f;

        auto& marimba = p[10];
        marimba.wave1 = Wave::sine; marimba.wave2 = Wave::sine; marimba.mix2 = 0.4f; marimba.ratio2 = 4.0f; marimba.partialDecay = 0.08f;
        marimba.attack = 0.002f; marimba.decay = 0.6f; marimba.sustain = 0.001f; marimba.release = 0.1f; marimba.level = 0.4f;

        auto& lead = p[11];
        lead.wave1 = Wave::saw; lead.wave2 = Wave::square; lead.mix2 = 1.0f; lead.detune2 = 8.0f;
        lead.attack = 0.01f; lead.decay = 0.2f; lead.sustain = 0.7f; lead.release = 0.12f;
        lead.cutoffMul = 3.0f; lead.cutoffMax = 9000.0f; lead.envAmount = 1.6f; lead.envTime = 0.25f; lead.q = 2.0f; lead.level = 0.14f;

        auto& pad = p[12];
        pad.wave1 = Wave::saw; pad.wave2 = Wave::saw; pad.mix2 = 1.0f; pad.detune2 = 20.0f;
        pad.attack = 0.25f; pad.decay = 0.5f; pad.sustain = 0.8f; pad.release = 0.7f;
        pad.cutoffMul = 4.0f; pad.cutoffMax = 2400.0f; pad.level = 0.1f;

        auto& bell = p[13];
        bell.wave1 = Wave::sine; bell.fmRatio = 3.5f; bell.fmIndex = 2.2f; bell.fmDecay = 1.0f;
        bell.attack = 0.002f; bell.decay = 1.4f; bell.sustain = 0.06f; bell.release = 0.5f; bell.level = 0.24f;

        auto& backing = p[14];
        backing.wave1 = Wave::triangle; backing.wave2 = Wave::saw; backing.mix2 = 0.5f; backing.detune2 = 7.0f;
        backing.attack = 0.05f; backing.decay = 0.6f; backing.sustain = 0.6f; backing.release = 0.3f;
        backing.cutoffMax = 1400.0f; backing.level = 0.06f;

        auto& backingBass = p[15];
        backingBass.wave1 = Wave::sine; backingBass.wave2 = Wave::triangle; backingBass.mix2 = 1.0f;
        backingBass.attack = 0.01f; backingBass.decay = 0.4f; backingBass.sustain = 0.55f; backingBass.release = 0.15f;
        backingBass.level = 0.18f;
        return p;
    }();

    return patches[(size_t) juce::jlimit (0, (int) patches.size() - 1, index)];
}

const SoundEngine::Kit& SoundEngine::kitParams (int kit)
{
    static const Kit kits[] = {
        { 120.0f, 50.0f, 0.40f, 190.0f, 0.20f, 0.050f, 18000.0f }, // acoustic
        { 110.0f, 38.0f, 1.10f, 240.0f, 0.16f, 0.040f, 18000.0f }, // 808
        { 170.0f, 48.0f, 0.45f, 220.0f, 0.22f, 0.060f, 18000.0f }, // 909
        { 105.0f, 48.0f, 0.35f, 180.0f, 0.18f, 0.045f, 3800.0f },  // lo-fi
    };
    return kits[juce::jlimit (0, 3, kit)];
}

//==============================================================================
void SoundEngine::Envelope::start (const Patch& p, double sr)
{
    stage = attack;
    value = 0.0f;
    attackStep = (float) (1.0 / (juce::jmax (0.001f, p.attack) * sr));
    decayCoef = studio::decayCoef (p.decay, sr);
    releaseCoef = studio::decayCoef (p.release, sr);
    sustainLevel = juce::jmax (0.0001f, p.sustain);
}

float SoundEngine::Envelope::next()
{
    switch (stage)
    {
        case attack:
            value += attackStep;
            if (value >= 1.0f) { value = 1.0f; stage = decay; }
            break;
        case decay:
            value = sustainLevel + (value - sustainLevel) * decayCoef;
            if (value - sustainLevel < 0.0005f) stage = sustain;
            break;
        case sustain:
            value = sustainLevel;
            break;
        case release:
            value *= releaseCoef;
            if (value < 0.0001f) { value = 0.0f; stage = idle; }
            break;
        case idle:
        default:
            value = 0.0f;
            break;
    }
    return value;
}

void SoundEngine::Filter::set (float cutoff, float q, double sr)
{
    const auto fc = juce::jlimit (20.0f, (float) (sr * 0.45), cutoff);
    g = (float) std::tan (juce::MathConstants<double>::pi * fc / sr);
    k = 1.0f / juce::jmax (0.3f, q);
}

float SoundEngine::Filter::lowpass (float x)
{
    const auto a1 = 1.0f / (1.0f + g * (g + k));
    const auto a2 = g * a1;
    const auto a3 = g * a2;
    const auto v3 = x - ic2;
    const auto v1 = a1 * ic1 + a2 * v3;
    const auto v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2.0f * v1 - ic1;
    ic2 = 2.0f * v2 - ic2;
    return v2;
}

float SoundEngine::Filter::bandpass (float x)
{
    const auto a1 = 1.0f / (1.0f + g * (g + k));
    const auto a2 = g * a1;
    const auto a3 = g * a2;
    const auto v3 = x - ic2;
    const auto v1 = a1 * ic1 + a2 * v3;
    const auto v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2.0f * v1 - ic1;
    ic2 = 2.0f * v2 - ic2;
    return v1;
}

//==============================================================================
void SoundEngine::prepare (double sampleRate)
{
    sr = sampleRate;
    juce::Reverb::Parameters params;
    params.roomSize = 0.55f;
    params.damping = 0.5f;
    params.wetLevel = 0.16f;
    params.dryLevel = 1.0f;
    params.width = 1.0f;
    reverb.setParameters (params);
    reverb.setSampleRate (sampleRate);
    songBus.setSize (2, 8192);
    reset();
}

void SoundEngine::reset()
{
    for (auto& v : voices) v.active = false;
    for (auto& d : drums) d.active = false;
    reverb.reset();
    drumBusL = {};
    drumBusR = {};
}

float SoundEngine::noise()
{
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    return (float) ((double) rng / 2147483648.0 - 1.0);
}

void SoundEngine::noteOn (int patchIdx, int midiNote, float velocity, int delay, int gate)
{
    // Free voice, else steal the oldest.
    Voice* target = nullptr;
    for (auto& v : voices)
        if (! v.active) { target = &v; break; }
    if (target == nullptr)
    {
        target = &voices[0];
        for (auto& v : voices)
            if (v.age < target->age) target = &v;
    }

    auto& v = *target;
    v = Voice {};
    v.active = true;
    v.patch = &patch (patchIdx);
    v.note = midiNote;
    v.velocity = velocity;
    v.delay = juce::jmax (0, delay);
    v.gate = juce::jmax (1, gate);
    v.freq = 440.0 * std::pow (2.0, (midiNote - 69) / 12.0);
    v.age = ++ageCounter;
    v.env.start (*v.patch, sr);
}

void SoundEngine::drumHit (int type, float velocity, int delay, int kit)
{
    if (type < 0 || type >= numDrums) return;
    const auto& k = kitParams (kit);

    // A closed hat chokes a ringing open hat.
    if (type == 4)
        for (auto& d : drums)
            if (d.active && d.type == 5) d.coef1 = decayCoef (0.03f, sr);

    DrumVoice* target = nullptr;
    for (auto& d : drums)
        if (! d.active) { target = &d; break; }
    if (target == nullptr) target = &drums[(size_t) (ageCounter++ % drums.size())];

    auto& d = *target;
    d = DrumVoice {};
    d.active = true;
    d.type = type;
    d.velocity = velocity;
    d.delay = juce::jmax (0, delay);
    d.env1 = 1.0f;
    d.env2 = 1.0f;

    switch (type)
    {
        case 0: d.coef1 = decayCoef (k.kickDecay, sr); d.coef2 = decayCoef (0.015f, sr); break;                 // kick
        case 1: d.coef1 = decayCoef (k.snareDecay, sr); d.coef2 = decayCoef (0.1f, sr); break;                  // snare
        case 2: d.filter.set (1200.0f, 0.9f, sr); break;                                                         // clap
        case 3: d.coef1 = decayCoef (0.04f, sr); d.coef2 = decayCoef (0.02f, sr); d.filter.set (1600.0f, 3.0f, sr); break; // rim
        case 4: d.coef1 = decayCoef (k.hatDecay, sr); break;                                                     // closed hat
        case 5: d.coef1 = decayCoef (0.4f, sr); break;                                                           // open hat
        case 6: d.coef1 = decayCoef (0.4f, sr); break;                                                           // low tom
        case 7: d.coef1 = decayCoef (0.3f, sr); break;                                                           // high tom
        case 8: d.coef1 = decayCoef (0.75f, sr); d.coef2 = decayCoef (0.45f, sr); d.filter.set (8500.0f, 1.2f, sr); break; // ride
        case 9: d.coef1 = decayCoef (1.5f, sr); break;                                                           // crash
        case 10: d.coef1 = decayCoef (0.075f, sr); d.filter.set (6500.0f, 1.0f, sr); break;                     // shaker
        case 11: d.coef1 = decayCoef (0.3f, sr); d.filter.set (750.0f, 2.0f, sr); break;                        // cowbell
        default: break;
    }
}

void SoundEngine::releaseAll()
{
    for (auto& v : voices)
        if (v.active) { v.delay = 0; v.env.noteOff(); }
}

//==============================================================================
float SoundEngine::renderVoice (Voice& v)
{
    if (v.delay > 0) { --v.delay; return 0.0f; }

    const auto& p = *v.patch;
    if (v.gate > 0 && --v.gate == 0) v.env.noteOff();

    const auto env = v.env.next();
    if (v.env.stage == Envelope::idle) { v.active = false; return 0.0f; }

    const auto t = v.time;
    v.time += 1.0 / sr;

    // Vibrato fades in after vibDelay.
    double f = v.freq;
    if (p.vibCents > 0.0f)
    {
        v.vibPhase += p.vibRate / sr;
        const auto depth = p.vibCents * juce::jmin (1.0, t / juce::jmax (0.01f, p.vibDelay));
        f *= std::pow (2.0, depth * std::sin (twoPi * v.vibPhase) / 1200.0);
    }

    auto osc = [] (Wave w, double& phase, double inc)
    {
        const auto ph = phase;
        phase += inc;
        if (phase >= 1.0) phase -= 1.0;
        switch (w)
        {
            case Wave::sine:     return (float) std::sin (twoPi * ph);
            case Wave::saw:      return (float) (2.0 * ph - 1.0) - polyBlep (ph, inc);
            case Wave::square:
            {
                auto s = ph < 0.5 ? 1.0f : -1.0f;
                s += polyBlep (ph, inc);
                s -= polyBlep (std::fmod (ph + 0.5, 1.0), inc);
                return s;
            }
            case Wave::triangle: return (float) (4.0 * std::abs (ph - 0.5) - 1.0);
        }
        return 0.0f;
    };

    float s;
    if (p.fmRatio > 0.0f)
    {
        // FM bell: the modulation index fades over about fmDecay seconds.
        const auto index = p.fmIndex * (float) std::exp (-3.0 * t / p.fmDecay) + 0.05f;
        v.phaseMod += f * p.fmRatio / sr;
        if (v.phaseMod >= 1.0) v.phaseMod -= 1.0;
        const auto mod = index * std::sin (twoPi * v.phaseMod);
        v.phase1 += f / sr;
        if (v.phase1 >= 1.0) v.phase1 -= 1.0;
        s = (float) std::sin (twoPi * v.phase1 + mod);
    }
    else
    {
        s = osc (p.wave1, v.phase1, f / sr);
        if (p.mix2 > 0.0f)
        {
            const auto f2 = f * p.ratio2 * std::pow (2.0, p.detune2 / 1200.0);
            auto level2 = p.mix2;
            if (p.partialDecay > 0.0f) level2 *= (float) std::exp (-t / p.partialDecay);
            s += level2 * osc (p.wave2, v.phase2, f2 / sr);
        }
        if (p.noise > 0.0f) s += p.noise * 4.0f * noise() * env;
    }

    // Lowpass, updated every 16 samples.
    if (p.cutoffMul < 99.0f || p.cutoffMax < 15000.0f)
    {
        if (v.filterCounter-- <= 0)
        {
            v.filterCounter = 16;
            auto cutoff = (float) f * p.cutoffMul;
            if (p.envAmount != 0.0f) cutoff *= 1.0f + p.envAmount * (float) std::exp (-t / p.envTime);
            v.filter.set (juce::jmin (cutoff, p.cutoffMax), p.q, sr);
        }
        s = v.filter.lowpass (s);
    }

    if (p.drive > 0.0f) s = std::tanh (s * p.drive) * 0.6f;

    return s * env * p.level * v.velocity;
}

float SoundEngine::renderDrum (DrumVoice& d, const Kit& k)
{
    if (d.delay > 0) { --d.delay; return 0.0f; }

    const auto t = d.time;
    d.time += 1.0 / sr;
    auto highpass = [&d] (float x, float a)
    {
        d.hpState = a * (d.hpState + x - d.hpPrev);
        d.hpPrev = x;
        return d.hpState;
    };
    auto hpCoef = [this] (float freq) { return (float) (1.0 / (1.0 + twoPi * freq / sr)); };

    float out = 0.0f;
    switch (d.type)
    {
        case 0: // kick: falling sine plus a click
        {
            const auto f = k.kickEnd + (k.kickPitch - k.kickEnd) * std::exp (-t / 0.03);
            d.phase1 += f / sr;
            out = (float) std::sin (twoPi * d.phase1) * d.env1 + highpass (noise(), hpCoef (3000.0f)) * d.env2 * 0.25f;
            break;
        }
        case 1: // snare: noise plus a falling tone
        {
            const auto f = k.snareTone * (0.7 + 0.3 * std::exp (-t / 0.05));
            d.phase1 += f / sr;
            if (d.phase1 >= 1.0) d.phase1 -= 1.0;
            out = highpass (noise(), hpCoef (1400.0f)) * d.env1 * 0.7f
                + (float) (4.0 * std::abs (d.phase1 - 0.5) - 1.0) * d.env2 * 0.55f;
            break;
        }
        case 2: // clap: three quick bursts, then a tail
        {
            float env;
            if (t < 0.032)
            {
                const auto burstStart = std::floor (t / 0.011) * 0.011;
                env = 0.8f * (float) std::exp (-(t - burstStart) / 0.004);
            }
            else
            {
                env = 0.7f * (float) std::exp (-(t - 0.032) / 0.05);
            }
            out = d.filter.bandpass (noise()) * env * 1.6f;
            if (t > 0.3) d.active = false;
            return out * d.velocity;
        }
        case 3: // rim
        {
            d.phase1 += 820.0 / sr;
            d.phase2 += 1650.0 / sr;
            if (d.phase1 >= 1.0) d.phase1 -= 1.0;
            if (d.phase2 >= 1.0) d.phase2 -= 1.0;
            out = d.filter.bandpass ((float) (4.0 * std::abs (d.phase1 - 0.5) - 1.0)) * d.env1 * 1.2f
                + (d.phase2 < 0.5 ? 0.12f : -0.12f) * d.env2;
            break;
        }
        case 4: out = highpass (noise(), hpCoef (7500.0f)) * d.env1 * 0.42f; break; // closed hat
        case 5: out = highpass (noise(), hpCoef (7000.0f)) * d.env1 * 0.38f; break; // open hat
        case 6:
        case 7: // toms
        {
            const auto start = d.type == 6 ? 130.0 : 210.0;
            const auto end = d.type == 6 ? 80.0 : 140.0;
            d.phase1 += (end + (start - end) * std::exp (-t / 0.12)) / sr;
            out = (float) std::sin (twoPi * d.phase1) * d.env1 * (d.type == 6 ? 0.8f : 0.7f);
            break;
        }
        case 8: // ride
        {
            d.phase2 += 3150.0 / sr;
            if (d.phase2 >= 1.0) d.phase2 -= 1.0;
            out = d.filter.bandpass (noise()) * d.env1 * 0.5f + (d.phase2 < 0.5 ? 0.03f : -0.03f) * d.env2;
            break;
        }
        case 9: out = highpass (noise(), hpCoef (4200.0f)) * d.env1 * 0.42f; break; // crash
        case 10: // shaker: short swell
        {
            const auto swell = (float) juce::jmin (1.0, t / 0.012);
            out = d.filter.bandpass (noise()) * swell * d.env1 * 0.35f;
            if (t < 0.012) d.env1 = 1.0f / d.coef1; // hold until the swell peaks
            break;
        }
        case 11: // cowbell
        {
            d.phase1 += 545.0 / sr;
            d.phase2 += 815.0 / sr;
            if (d.phase1 >= 1.0) d.phase1 -= 1.0;
            if (d.phase2 >= 1.0) d.phase2 -= 1.0;
            const auto sq = (d.phase1 < 0.5 ? 1.0f : -1.0f) + (d.phase2 < 0.5 ? 1.0f : -1.0f);
            out = d.filter.bandpass (sq) * d.env1 * 0.35f;
            break;
        }
        default: break;
    }

    d.env1 *= d.coef1;
    d.env2 *= d.coef2;
    if (d.env1 < 0.0001f && d.env2 < 0.0001f) d.active = false;
    return out * d.velocity;
}

void SoundEngine::render (juce::AudioBuffer<float>& buffer, int numSamples, float songGain, float drumGain, float master, int kit)
{
    const auto& k = kitParams (kit);
    if (songBus.getNumSamples() < numSamples) songBus.setSize (2, numSamples, false, false, true);
    songBus.clear (0, numSamples);

    auto* sl = songBus.getWritePointer (0);
    auto* sr2 = songBus.getWritePointer (1);
    for (auto& v : voices)
    {
        if (! v.active) continue;
        for (int i = 0; i < numSamples && v.active; ++i)
            sl[i] += renderVoice (v);
    }
    juce::FloatVectorOperations::copy (sr2, sl, numSamples);
    reverb.processStereo (sl, sr2, numSamples);

    const auto numCh = buffer.getNumChannels();
    auto* outL = buffer.getWritePointer (0);
    auto* outR = numCh > 1 ? buffer.getWritePointer (1) : nullptr;

    drumBusL.set (k.filter, 0.7f, sr);
    for (int i = 0; i < numSamples; ++i)
    {
        float dsum = 0.0f;
        for (auto& d : drums)
            if (d.active) dsum += renderDrum (d, k);
        if (k.filter < 15000.0f) dsum = drumBusL.lowpass (dsum);

        const auto l = (sl[i] * songGain + dsum * drumGain) * master;
        const auto r = (sr2[i] * songGain + dsum * drumGain) * master;
        outL[i] += std::tanh (l * 1.2f) / 1.2f;
        if (outR != nullptr) outR[i] += std::tanh (r * 1.2f) / 1.2f;
    }
}

} // namespace studio
