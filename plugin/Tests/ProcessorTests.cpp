// Headless checks for the plugin processor: feeds it a state captured from
// the web UI and runs it against a simulated DAW transport.
//
//   StudioTests path/to/state.json

#include "../Source/PluginProcessor.h"

#include <chrono>
#include <cmath>
#include <iostream>

namespace
{
    struct FakePlayHead : juce::AudioPlayHead
    {
        bool playing = false;
        double ppq = 0.0, bpm = 120.0;

        juce::Optional<PositionInfo> getPosition() const override
        {
            PositionInfo info;
            info.setIsPlaying (playing);
            info.setPpqPosition (ppq);
            info.setBpm (bpm);
            return info;
        }
    };

    struct Counts
    {
        int songOn = 0, drumOn = 0, off = 0, allOn = 0, firstOnSample = -1;
        float peak = 0.0f;
        bool finite = true;
    };

    int failures = 0;

    void check (bool ok, const juce::String& what)
    {
        std::cout << (ok ? "  PASS  " : "  FAIL  ") << what << std::endl;
        if (! ok) ++failures;
    }

    // Counts the MIDI of one block; note-ons from sample `countUntil` on are
    // ignored (so a test can stop exactly at a position inside a block).
    void runBlock (StudioProcessor& p, juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi, Counts& c, int countUntil = 1 << 30)
    {
        midi.clear();
        p.processBlock (buffer, midi);
        for (const auto meta : midi)
        {
            const auto m = meta.getMessage();
            if (m.isNoteOn()) ++c.allOn;
            if (m.isNoteOn() && meta.samplePosition >= countUntil) continue;
            if (m.isNoteOn())
            {
                if (m.getChannel() == 10) ++c.drumOn; else ++c.songOn;
                if (c.firstOnSample < 0) c.firstOnSample = meta.samplePosition;
            }
            else if (m.isNoteOff())
            {
                ++c.off;
            }
        }
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const auto s = buffer.getSample (ch, i);
                if (! std::isfinite (s)) c.finite = false;
                c.peak = juce::jmax (c.peak, std::abs (s));
            }
    }

    // Plays from `startQ` for `lengthQ` quarter notes with the host running.
    Counts playHost (StudioProcessor& p, FakePlayHead& head, double startQ, double lengthQ, double sr, int block)
    {
        Counts c;
        juce::AudioBuffer<float> buffer (2, block);
        juce::MidiBuffer midi;
        head.playing = true;
        head.ppq = startQ;
        const auto qPerSample = head.bpm / 60.0 / sr;
        const auto qPerBlock = block * qPerSample;
        const auto endQ = startQ + lengthQ;
        while (head.ppq < endQ - 1e-12)
        {
            runBlock (p, buffer, midi, c, (int) std::floor ((endQ - head.ppq) / qPerSample));
            head.ppq += qPerBlock;
        }
        return c;
    }
}

int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI juceInit;

    if (argc < 2)
    {
        std::cerr << "usage: StudioTests state.json" << std::endl;
        return 2;
    }

    auto state = juce::JSON::parse (juce::File (juce::String (argv[1])).loadFileAsString());
    check (state.isObject(), "state JSON from the web UI parses");
    state.getDynamicObject()->setProperty ("previewSong", false);
    state.getDynamicObject()->setProperty ("previewDrums", false);

    const auto songEvents = state["song"]["events"].size();
    const auto songLoop = (double) state["song"]["loopQ"];
    const auto drumHits = state["drums"]["hits"].size();
    const auto drumLoop = (double) state["drums"]["loopQ"];
    std::cout << "song: " << songEvents << " events over " << songLoop << " quarters; drums: "
              << drumHits << " hits over " << drumLoop << " quarters" << std::endl;

    std::cout << "\nSynth patches from the page:" << std::endl;
    {
        const auto data = PlayData::fromVar (state);
        auto* pagePatches = state["patches"].getDynamicObject();
        check (pagePatches != nullptr && (int) data->patches.size() == pagePatches->getProperties().size(),
               "one patch per sound the song uses (" + juce::String ((int) data->patches.size()) + ")");
        bool matches = true;
        for (const auto& n : data->song)
        {
            const auto name = state["song"]["events"][(int) (&n - data->song.data())][4].toString();
            const auto expected = (float) (double) state["patches"][juce::Identifier (name)]["level"];
            if (std::abs (data->patches[(size_t) n.patch].level - expected) > 1e-6f) matches = false;
        }
        check (matches, "each note uses its sound's settings from the page");
    }

    constexpr double sr = 48000.0;
    constexpr int block = 512;

    StudioProcessor proc;
    proc.setPlayConfigDetails (0, 2, sr, block);
    proc.prepareToPlay (sr, block);
    FakePlayHead head;
    head.bpm = 132.0;
    proc.setPlayHead (&head);
    proc.applyUiState (state);

    std::cout << "\nHost transport, two song loops at 132 BPM:" << std::endl;
    const auto t0 = std::chrono::steady_clock::now();
    auto c = playHost (proc, head, 0.0, songLoop * 2.0, sr, block);
    const auto elapsed = std::chrono::duration<double> (std::chrono::steady_clock::now() - t0).count();
    const auto audioSeconds = songLoop * 2.0 * 60.0 / head.bpm;
    check (c.songOn == songEvents * 2, "every song note plays once per loop (" + juce::String (c.songOn) + " of " + juce::String (songEvents * 2) + ")");
    const auto expectedDrums = (int) std::llround (drumHits * (songLoop * 2.0 / drumLoop));
    check (std::abs (c.drumOn - expectedDrums) <= (int) drumHits, "drum hits loop with the drum pattern (" + juce::String (c.drumOn) + ", expected about " + juce::String (expectedDrums) + ")");
    check (c.firstOnSample == 0, "notes on beat 1 land on the first sample");
    check (c.finite && c.peak > 0.02f && c.peak <= 1.0f, "audio is non-silent, finite and within full scale (peak " + juce::String (c.peak, 3) + ")");
    check (elapsed < audioSeconds * 0.25, "renders faster than 4x real time (" + juce::String (audioSeconds / elapsed, 1) + "x)");

    std::cout << "\nStopping the transport:" << std::endl;
    {
        Counts stopCounts;
        juce::AudioBuffer<float> buffer (2, block);
        juce::MidiBuffer midi;
        head.playing = false;
        runBlock (proc, buffer, midi, stopCounts);
        check (c.off + stopCounts.off == c.allOn, "every note-on gets a note-off (" + juce::String (c.off + stopCounts.off) + "/" + juce::String (c.allOn) + ")");
    }

    std::cout << "\nJumping back while playing:" << std::endl;
    {
        auto a = playHost (proc, head, 8.0, 1.0, sr, block);
        Counts jump;
        juce::AudioBuffer<float> buffer (2, block);
        juce::MidiBuffer midi;
        head.ppq = 0.0;
        runBlock (proc, buffer, midi, jump);
        check (jump.off >= a.songOn + a.drumOn - a.off, "a jump releases the sounding notes");
        head.playing = false;
        runBlock (proc, buffer, midi, jump);
    }

    std::cout << "\nMid-song start (DAW starts at bar 3):" << std::endl;
    {
        const auto startQ = juce::jmin (8.0, songLoop * 0.5);
        auto mid = playHost (proc, head, startQ, songLoop - startQ, sr, block);
        int expected = 0;
        for (const auto& e : *state["song"]["events"].getArray())
            if ((double) e[0] >= startQ - 1e-9) ++expected;
        check (mid.songOn == expected, "only the notes from the start position onward play (" + juce::String (mid.songOn) + "/" + juce::String (expected) + ")");
        head.playing = false;
        juce::AudioBuffer<float> buffer (2, block);
        juce::MidiBuffer midi;
        Counts tmp;
        runBlock (proc, buffer, midi, tmp);
    }

    std::cout << "\nPreview with the DAW stopped:" << std::endl;
    {
        auto preview = state.clone();
        preview.getDynamicObject()->setProperty ("previewSong", true);
        preview.getDynamicObject()->setProperty ("previewDrums", true);
        proc.applyUiState (preview);
        Counts pc;
        juce::AudioBuffer<float> buffer (2, block);
        juce::MidiBuffer midi;
        head.playing = false;
        for (int b = 0; b < 200; ++b) runBlock (proc, buffer, midi, pc);
        check (pc.songOn > 0 && pc.drumOn > 0 && pc.peak > 0.02f, "Play in the plugin window previews song and drums");
        proc.applyUiState (state);
        runBlock (proc, buffer, midi, pc);
    }

    std::cout << "\nMIDI only (built-in sound off):" << std::endl;
    {
        proc.builtInSound = false;
        juce::AudioBuffer<float> buffer (2, block);
        juce::MidiBuffer midi;
        Counts settle;
        head.playing = false;
        for (int b = 0; b < 400; ++b) runBlock (proc, buffer, midi, settle); // let earlier notes ring out
        auto m = playHost (proc, head, 0.0, 4.0, sr, block);
        check (m.songOn + m.drumOn > 0 && m.peak < 1e-4f, "MIDI still goes out while the plugin stays silent");
        proc.builtInSound = true;
        head.playing = false;
        Counts tmp;
        runBlock (proc, buffer, midi, tmp);
    }

    std::cout << "\nSaving and reloading with the project:" << std::endl;
    {
        juce::MemoryBlock saved;
        proc.getStateInformation (saved);
        StudioProcessor reloaded;
        reloaded.setPlayConfigDetails (0, 2, sr, block);
        reloaded.prepareToPlay (sr, block);
        FakePlayHead head2;
        head2.bpm = 132.0;
        reloaded.setPlayHead (&head2);
        reloaded.setStateInformation (saved.getData(), (int) saved.getSize());
        auto r = playHost (reloaded, head2, 0.0, songLoop, sr, block);
        check (r.songOn == songEvents, "a reloaded project plays the same song (" + juce::String (r.songOn) + "/" + juce::String (songEvents) + ")");
        check (reloaded.getSession() == state["session"].toString(), "the page session is restored for the editor");
    }

    std::cout << "\nMIDI files for drag and drop:" << std::endl;
    {
        const auto song = proc.getSongMidi();
        juce::MemoryInputStream in (song.data, false);
        juce::MidiFile file;
        check (song.data.getSize() > 0 && file.readFrom (in), "song + drums MIDI decodes as a valid MIDI file (" + song.name + ")");
        check (file.getNumTracks() >= 3, "it has a track per part (" + juce::String (file.getNumTracks()) + " tracks)");
    }

    proc.releaseResources();
    std::cout << "\n" << (failures == 0 ? "All checks passed." : juce::String (failures) + " check(s) failed.") << std::endl;
    return failures == 0 ? 0 : 1;
}
