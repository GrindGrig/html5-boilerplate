#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>

namespace
{
    // General MIDI drum notes, in the web app's drum order.
    constexpr int gmDrumNotes[studio::SoundEngine::numDrums] = { 36, 38, 39, 37, 42, 46, 45, 50, 51, 49, 70, 56 };
    constexpr int drumChannel = 10;
    constexpr double drumNoteLength = 0.1; // quarter notes

    double toDouble (const juce::var& v, double fallback = 0.0)
    {
        return v.isVoid() || v.isUndefined() ? fallback : (double) v;
    }
}

//==============================================================================
std::shared_ptr<PlayData> PlayData::fromVar (const juce::var& v)
{
    auto d = std::make_shared<PlayData>();
    if (! v.isObject()) return d;

    const auto song = v["song"];
    d->songLoop = toDouble (song["loopQ"]);
    if (auto* events = song["events"].getArray())
    {
        d->song.reserve ((size_t) events->size());
        for (const auto& e : *events)
        {
            if (! e.isArray() || e.size() < 6) continue;
            const auto patch = studio::SoundEngine::patchIndex (e[4].toString());
            d->song.push_back ({ toDouble (e[0]), toDouble (e[1]), (int) e[2], (float) toDouble (e[3], 0.8),
                                 patch < 0 ? 0 : patch, juce::jlimit (1, 16, (int) e[5]) });
        }
    }

    const auto drums = v["drums"];
    d->drumLoop = toDouble (drums["loopQ"]);
    if (auto* hits = drums["hits"].getArray())
    {
        d->drums.reserve ((size_t) hits->size());
        for (const auto& h : *hits)
            if (h.isArray() && h.size() >= 3)
                d->drums.push_back ({ toDouble (h[0]), juce::jlimit (0, studio::SoundEngine::numDrums - 1, (int) h[1]), (float) toDouble (h[2], 0.8) });
    }

    d->loop = (bool) v.getProperty ("loop", true);
    d->previewSong = (bool) v.getProperty ("previewSong", false);
    d->previewDrums = (bool) v.getProperty ("previewDrums", false);
    d->previewBpm = juce::jlimit (20.0, 400.0, toDouble (v["previewBpm"], 120.0));
    d->kit = (int) v.getProperty ("kit", 0);
    d->humanize = (bool) v.getProperty ("humanize", false);
    d->master = (float) toDouble (v["master"], 0.8);
    d->songGain = (float) toDouble (v["songGain"], 0.8);
    d->drumGain = (float) toDouble (v["drumGain"], 0.8);
    return d;
}

//==============================================================================
StudioProcessor::StudioProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
    playData = std::make_shared<PlayData>();
    pendingOffs.reserve (4096);
}

bool StudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void StudioProcessor::prepareToPlay (double sampleRate, int)
{
    engine.prepare (sampleRate);
    pendingOffs.clear();
    wasPlaying = false;
}

void StudioProcessor::setPlayData (std::shared_ptr<PlayData> data)
{
    previousData = std::atomic_load (&playData);
    std::atomic_store (&playData, std::move (data));
}

void StudioProcessor::applyUiState (const juce::var& state)
{
    // Keep what is needed to play (and to save with the project) without
    // the MIDI files and the page session.
    auto playOnly = juce::var (new juce::DynamicObject());
    if (auto* src = state.getDynamicObject())
        for (const auto& p : src->getProperties())
            if (p.name.toString() != "midiSong" && p.name.toString() != "midiDrums"
                && p.name.toString() != "session" && p.name.toString() != "type")
                playOnly.getDynamicObject()->setProperty (p.name, p.value);

    auto decode = [] (const juce::var& file)
    {
        MidiFileData out;
        if (! file.isObject()) return out;
        out.name = file["name"].toString();
        juce::MemoryOutputStream stream (out.data, false);
        juce::Base64::convertFromBase64 (stream, file["data"].toString());
        return out;
    };

    {
        const juce::ScopedLock sl (uiLock);
        playJson = juce::JSON::toString (playOnly, true);
        session = state["session"].toString();
        songMidi = decode (state["midiSong"]);
        drumsMidi = decode (state["midiDrums"]);
    }
    setPlayData (PlayData::fromVar (playOnly));
}

void StudioProcessor::previewDrum (int drum, float velocity)
{
    previewVelocity = velocity;
    previewRequest = drum;
}

juce::String StudioProcessor::getSession() const
{
    const juce::ScopedLock sl (uiLock);
    return session;
}

StudioProcessor::MidiFileData StudioProcessor::getSongMidi() const
{
    const juce::ScopedLock sl (uiLock);
    return songMidi;
}

StudioProcessor::MidiFileData StudioProcessor::getDrumsMidi() const
{
    const juce::ScopedLock sl (uiLock);
    return drumsMidi;
}

//==============================================================================
void StudioProcessor::flushNoteOffs (juce::MidiBuffer& midi, int sample)
{
    for (const auto& off : pendingOffs)
        midi.addEvent (juce::MidiMessage::noteOff (off.channel, off.note), sample);
    pendingOffs.clear();
}

void StudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const auto numSamples = buffer.getNumSamples();
    buffer.clear();
    midi.clear(); // the plugin generates its own MIDI; incoming notes are not used

    const auto data = std::atomic_load (&playData);
    const auto sr = getSampleRate() > 0 ? getSampleRate() : 44100.0;

    if (const auto drum = previewRequest.exchange (-1); drum >= 0)
        engine.drumHit (drum, previewVelocity, 0, data->kit);

    // Where are we? The host's transport wins; with the host stopped, the
    // page's Play buttons run a preview from bar 1.
    bool hostPlaying = false;
    double hostQ = 0.0, hostBpm = 120.0;
    if (auto* playHead = getPlayHead())
    {
        if (const auto pos = playHead->getPosition())
        {
            hostPlaying = pos->getIsPlaying();
            if (const auto q = pos->getPpqPosition()) hostQ = *q;
            if (const auto bpm = pos->getBpm()) hostBpm = *bpm;
        }
    }

    const bool previewing = ! hostPlaying && (data->previewSong || data->previewDrums);
    if (previewing && ! wasPreviewing) internalQ = 0.0;
    wasPreviewing = previewing;

    const bool playing = hostPlaying || previewing;
    const double bpm = hostPlaying ? hostBpm : data->previewBpm;
    const double q0 = hostPlaying ? hostQ : internalQ;
    const bool songOn = (hostPlaying || data->previewSong) && data->songLoop > 0.0;
    const bool drumsOn = (hostPlaying || data->previewDrums) && data->drumLoop > 0.0;

    reportedQ = q0;
    reportedBpm = bpm;
    reportedPlaying = playing;
    reportedHost = hostPlaying;

    const auto builtIn = builtInSound.load();

    if (! playing)
    {
        if (wasPlaying)
        {
            flushNoteOffs (midi, 0);
            engine.releaseAll();
        }
        wasPlaying = false;
        engine.render (buffer, numSamples, data->songGain, data->drumGain, data->master, data->kit);
        return;
    }

    const double qPerSample = bpm / 60.0 / sr;
    const double q1 = q0 + numSamples * qPerSample;

    // A jump (loop, relocate, scrub) cuts the notes that were sounding.
    if (wasPlaying && std::abs (q0 - expectedQ) > juce::jmax (0.002, qPerSample * 4.0))
    {
        flushNoteOffs (midi, 0);
        engine.releaseAll();
    }
    wasPlaying = true;
    expectedQ = q1;

    auto offsetOf = [&] (double q) { return juce::jlimit (0, numSamples - 1, (int) ((q - q0) / qPerSample)); };

    // Note-offs that fall inside this block.
    for (size_t i = 0; i < pendingOffs.size();)
    {
        if (pendingOffs[i].endQ < q1)
        {
            midi.addEvent (juce::MidiMessage::noteOff (pendingOffs[i].channel, pendingOffs[i].note), offsetOf (pendingOffs[i].endQ));
            pendingOffs[i] = pendingOffs.back();
            pendingOffs.pop_back();
        }
        else
        {
            ++i;
        }
    }

    // Calls fn(event, absoluteQ) for every event of a loop starting in [q0, q1).
    auto scan = [&] (const auto& events, double loopLen, bool loops, auto&& fn)
    {
        if (! loops)
        {
            for (const auto& e : events)
                if (e.start >= q0 && e.start < q1) fn (e, e.start);
            return;
        }
        for (double cycle = std::floor (q0 / loopLen) * loopLen; cycle < q1; cycle += loopLen)
            for (const auto& e : events)
            {
                const auto t = cycle + e.start;
                if (t >= q0 && t < q1) fn (e, t);
            }
    };

    if (songOn)
    {
        scan (data->song, data->songLoop, data->loop, [&] (const PlayData::Note& n, double t)
        {
            const auto offset = offsetOf (t);
            if (builtIn)
                engine.noteOn (n.patch, n.note, n.velocity, offset, juce::jmax (1, (int) (n.length / qPerSample)));
            midi.addEvent (juce::MidiMessage::noteOn (n.channel, n.note, juce::jlimit (0.05f, 1.0f, n.velocity)), offset);
            if (pendingOffs.size() < pendingOffs.capacity())
                pendingOffs.push_back ({ t + juce::jmax (0.01, n.length), n.channel, n.note });
        });
    }

    if (drumsOn)
    {
        scan (data->drums, data->drumLoop, true, [&] (const PlayData::Hit& h, double t)
        {
            auto offset = offsetOf (t);
            auto velocity = h.velocity;
            if (data->humanize)
            {
                velocity *= 0.88f + random.nextFloat() * 0.2f;
                offset = juce::jlimit (0, numSamples - 1, offset + (int) ((random.nextFloat() - 0.5f) * 0.016f * (float) sr));
            }
            if (builtIn) engine.drumHit (h.drum, velocity, offset, data->kit);
            const auto note = gmDrumNotes[h.drum];
            midi.addEvent (juce::MidiMessage::noteOn (drumChannel, note, juce::jlimit (0.05f, 1.0f, velocity)), offset);
            if (pendingOffs.size() < pendingOffs.capacity())
                pendingOffs.push_back ({ t + drumNoteLength, drumChannel, note });
        });
    }

    engine.render (buffer, numSamples, data->songGain, data->drumGain, data->master, data->kit);

    if (! hostPlaying) internalQ = q1;
}

//==============================================================================
void StudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree tree ("MelodyDrumStudio");
    {
        const juce::ScopedLock sl (uiLock);
        tree.setProperty ("play", playJson, nullptr);
        tree.setProperty ("session", session, nullptr);
    }
    tree.setProperty ("builtInSound", builtInSound.load(), nullptr);
    if (auto xml = tree.createXml())
        copyXmlToBinary (*xml, destData);
}

void StudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr) return;
    const auto tree = juce::ValueTree::fromXml (*xml);
    if (! tree.isValid()) return;

    const auto json = tree.getProperty ("play").toString();
    {
        const juce::ScopedLock sl (uiLock);
        playJson = json;
        session = tree.getProperty ("session").toString();
    }
    builtInSound = (bool) tree.getProperty ("builtInSound", true);

    // Previews never resume on load; the host transport starts playback.
    auto parsed = juce::JSON::parse (json);
    auto play = PlayData::fromVar (parsed);
    play->previewSong = play->previewDrums = false;
    setPlayData (std::move (play));

    if (auto* editor = dynamic_cast<StudioEditor*> (getActiveEditor()))
        editor->sendSessionToPage();
}

juce::AudioProcessorEditor* StudioProcessor::createEditor()
{
    return new StudioEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new StudioProcessor();
}
