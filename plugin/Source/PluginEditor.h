#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

// A button you drag onto a DAW track to drop a MIDI file there.
class MidiDragButton : public juce::Component
{
public:
    MidiDragButton (juce::String labelText, std::function<StudioProcessor::MidiFileData()> source);

    void paint (juce::Graphics&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override { dragging = false; }
    void mouseEnter (const juce::MouseEvent&) override { repaint(); }
    void mouseExit (const juce::MouseEvent&) override { repaint(); }

private:
    juce::String label;
    std::function<StudioProcessor::MidiFileData()> getFile;
    bool dragging = false;
};

class StudioEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit StudioEditor (StudioProcessor&);
    ~StudioEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

    // Hands the saved session to the page (after the project loads).
    void sendSessionToPage();

private:
    void timerCallback() override;
    void handlePageMessage (const juce::var& message);
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url);
    void saveMidiFile (const juce::String& name, const juce::String& base64);

    StudioProcessor& processor;
    juce::WebBrowserComponent web;
    MidiDragButton dragSong, dragDrums;
    juce::ToggleButton builtInSound { "Built-in sound" };
    juce::Label hint;
    std::unique_ptr<juce::FileChooser> chooser;
    bool pageReady = false;
    int chunkId = -1;
    juce::StringArray chunks;
    std::map<int, int> chunksReceived;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StudioEditor)
};
