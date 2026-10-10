#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "SoundEngine.h"

#include <atomic>
#include <memory>
#include <vector>

// What the web UI asked the plugin to play. Times are in quarter notes, so
// playback follows the host's tempo.
struct PlayData
{
    struct Note { double start, length; int note; float velocity; int patch, channel; };
    struct Hit { double start; int drum; float velocity; };

    std::vector<Note> song;
    double songLoop = 0.0;
    bool loop = true;
    std::vector<Hit> drums;
    double drumLoop = 0.0;
    bool previewSong = false, previewDrums = false;
    double previewBpm = 120.0;
    int kit = 0;
    bool humanize = false;
    float master = 0.8f, songGain = 0.8f, drumGain = 0.8f;

    static std::shared_ptr<PlayData> fromVar (const juce::var& v);
};

class StudioProcessor : public juce::AudioProcessor
{
public:
    StudioProcessor();

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 2.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // Called on the message thread by the editor.
    void applyUiState (const juce::var& state);
    void previewDrum (int drum, float velocity);
    juce::String getSession() const;

    struct MidiFileData { juce::String name; juce::MemoryBlock data; };
    MidiFileData getSongMidi() const;
    MidiFileData getDrumsMidi() const;

    std::atomic<bool> builtInSound { true };

    // Transport position for the editor's playhead.
    std::atomic<double> reportedQ { 0.0 }, reportedBpm { 120.0 };
    std::atomic<bool> reportedPlaying { false }, reportedHost { false };

private:
    struct PendingOff { double endQ; int channel, note; };

    void setPlayData (std::shared_ptr<PlayData> data);
    void flushNoteOffs (juce::MidiBuffer& midi, int sample);

    studio::SoundEngine engine;
    std::shared_ptr<PlayData> playData;     // swapped with std::atomic_load / atomic_store
    std::shared_ptr<PlayData> previousData; // keeps the last state alive off the audio thread
    juce::String playJson, session;
    MidiFileData songMidi, drumsMidi;
    juce::CriticalSection uiLock;

    std::vector<PendingOff> pendingOffs;
    std::atomic<int> previewRequest { -1 };
    std::atomic<float> previewVelocity { 0.9f };
    double internalQ = 0.0, expectedQ = 0.0;
    bool wasPlaying = false, wasPreviewing = false;
    juce::Random random;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StudioProcessor)
};
