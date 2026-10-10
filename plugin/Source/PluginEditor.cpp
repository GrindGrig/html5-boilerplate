#include "PluginEditor.h"

#include "BinaryData.h"

namespace
{
    const juce::Colour background { 0xff0c0e13 };
    const juce::Colour panel { 0xff1e2230 };
    const juce::Colour line { 0xff2a3042 };
    const juce::Colour text { 0xffe7e9f0 };
    const juce::Colour muted { 0xff9097ab };
    const juce::Colour accent { 0xff9d8cff };

    constexpr int barHeight = 44;

    juce::WebBrowserComponent::Options webOptions (StudioEditor& editor,
                                                   std::function<void (const juce::var&)> onMessage,
                                                   juce::WebBrowserComponent::ResourceProvider provider)
    {
        juce::ignoreUnused (editor);
        return juce::WebBrowserComponent::Options {}
            .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2 {}
                                         .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory)
                                                                  .getChildFile ("MelodyDrumStudio")))
            .withNativeIntegrationEnabled()
            .withKeepPageLoadedWhenBrowserIsHidden()
            .withEventListener ("studio", std::move (onMessage))
            .withResourceProvider (std::move (provider));
    }
}

//==============================================================================
MidiDragButton::MidiDragButton (juce::String labelText, std::function<StudioProcessor::MidiFileData()> source)
    : label (std::move (labelText)), getFile (std::move (source))
{
    setMouseCursor (juce::MouseCursor::DraggingHandCursor);
}

void MidiDragButton::paint (juce::Graphics& g)
{
    const auto bounds = getLocalBounds().toFloat().reduced (1.0f);
    g.setColour (isMouseOver() ? accent.withAlpha (0.25f) : panel);
    g.fillRoundedRectangle (bounds, 7.0f);
    g.setColour (isMouseOver() ? accent : line);
    g.drawRoundedRectangle (bounds, 7.0f, 1.0f);
    g.setColour (text);
    g.setFont (juce::FontOptions (13.0f, juce::Font::bold));
    g.drawText (label, getLocalBounds(), juce::Justification::centred);
}

void MidiDragButton::mouseDrag (const juce::MouseEvent& e)
{
    if (dragging || e.getDistanceFromDragStart() < 6) return;
    const auto file = getFile();
    if (file.data.isEmpty()) return;

    // Write the file where the DAW can read it, then hand it over.
    const auto dir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("MelodyDrumStudio");
    dir.createDirectory();
    const auto target = dir.getChildFile (file.name.isNotEmpty() ? file.name : "melody-drum-studio.mid");
    if (! target.replaceWithData (file.data.getData(), file.data.getSize())) return;

    dragging = true;
    juce::DragAndDropContainer::performExternalDragDropOfFiles ({ target.getFullPathName() }, false, this,
                                                                [this] { dragging = false; });
}

//==============================================================================
StudioEditor::StudioEditor (StudioProcessor& p)
    : AudioProcessorEditor (p),
      processor (p),
      web (webOptions (*this,
                       [this] (const juce::var& message) { handlePageMessage (message); },
                       [this] (const juce::String& url) { return getResource (url); })),
      dragSong ("Drag song + drums MIDI", [&p] { return p.getSongMidi(); }),
      dragDrums ("Drag drums MIDI", [&p] { return p.getDrumsMidi(); })
{
    addAndMakeVisible (web);
    addAndMakeVisible (dragSong);
    addAndMakeVisible (dragDrums);

    builtInSound.setToggleState (processor.builtInSound.load(), juce::dontSendNotification);
    builtInSound.setColour (juce::ToggleButton::textColourId, text);
    builtInSound.setColour (juce::ToggleButton::tickColourId, accent);
    builtInSound.setTooltip ("Turn off to use only the MIDI output with your own instruments");
    builtInSound.onClick = [this] { processor.builtInSound = builtInSound.getToggleState(); };
    addAndMakeVisible (builtInSound);

    hint.setText ("MIDI out: one channel per part, in legend order from ch 1 (skipping 10); drums on ch 10", juce::dontSendNotification);
    hint.setColour (juce::Label::textColourId, muted);
    hint.setFont (juce::FontOptions (12.0f));
    hint.setJustificationType (juce::Justification::centredRight);
    addAndMakeVisible (hint);

    setResizable (true, true);
    setResizeLimits (720, 520, 2400, 1800);
    setSize (1180, 820);

   #if JUCE_LINUX
    // JUCE's Linux web view passes served files through a pipe that breaks
    // on large messages, so the page is written to disk and loaded from there.
    const auto webDir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("MelodyDrumStudio").getChildFile ("web");
    for (const auto* path : { "index.html", "css/style.css", "css/app.css", "js/app.js" })
    {
        if (const auto resource = getResource (juce::String ("/") + path))
        {
            const auto file = webDir.getChildFile (path);
            file.getParentDirectory().createDirectory();
            file.replaceWithData (resource->data.data(), resource->data.size());
        }
    }
    web.goToURL (juce::URL (webDir.getChildFile ("index.html")).toString (false));
   #else
    web.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
   #endif
    startTimerHz (30);
}

StudioEditor::~StudioEditor()
{
    stopTimer();
}

void StudioEditor::paint (juce::Graphics& g)
{
    g.fillAll (background);
    g.setColour (line);
    g.drawHorizontalLine (getHeight() - barHeight, 0.0f, (float) getWidth());
}

void StudioEditor::resized()
{
    auto area = getLocalBounds();
    auto bar = area.removeFromBottom (barHeight).reduced (10, 7);
    web.setBounds (area);

    dragSong.setBounds (bar.removeFromLeft (190));
    bar.removeFromLeft (8);
    dragDrums.setBounds (bar.removeFromLeft (150));
    bar.removeFromLeft (12);
    builtInSound.setBounds (bar.removeFromLeft (140));
    hint.setBounds (bar);
}

//==============================================================================
std::optional<juce::WebBrowserComponent::Resource> StudioEditor::getResource (const juce::String& url)
{
    const auto path = url.fromFirstOccurrenceOf ("/", false, false).upToFirstOccurrenceOf ("?", false, false);

    struct Entry { const char* path; const char* data; int size; const char* mime; };
    const Entry entries[] = {
        { "",              StudioWeb::index_html, StudioWeb::index_htmlSize, "text/html" },
        { "index.html",    StudioWeb::index_html, StudioWeb::index_htmlSize, "text/html" },
        { "css/style.css", StudioWeb::style_css,  StudioWeb::style_cssSize,  "text/css" },
        { "css/app.css",   StudioWeb::app_css,    StudioWeb::app_cssSize,    "text/css" },
        { "js/app.js",     StudioWeb::app_js,     StudioWeb::app_jsSize,     "text/javascript" },
    };

    for (const auto& e : entries)
    {
        if (path == e.path)
        {
            const auto* bytes = reinterpret_cast<const std::byte*> (e.data);
            return juce::WebBrowserComponent::Resource { std::vector<std::byte> (bytes, bytes + e.size), e.mime };
        }
    }
    return std::nullopt;
}

void StudioEditor::handlePageMessage (const juce::var& message)
{
    const auto type = message["type"].toString();

    // The page sends every message as chunks of JSON (see sendToPlugin in
    // app.js); reassemble, then handle the whole message.
    if (type == "chunk")
    {
        const auto id = (int) message["id"];
        const auto index = (int) message["i"];
        const auto count = (int) message["n"];
        if (id != chunkId)
        {
            chunkId = id;
            chunks.clearQuick();
        }
        if (count <= 0 || index < 0 || index >= count) return;
        while (chunks.size() < count) chunks.add ({});
        chunks.set (index, message["data"].toString());
        if (++chunksReceived[id] < count) return;
        chunksReceived.erase (id);
        const auto whole = juce::JSON::parse (chunks.joinIntoString (""));
        chunks.clearQuick();
        if (whole.isObject() && whole["type"].toString() != "chunk")
            handlePageMessage (whole);
        return;
    }

    if (type == "state")
    {
        processor.applyUiState (message);
    }
    else if (type == "ready")
    {
        pageReady = true;
        sendSessionToPage();
    }
    else if (type == "preview")
    {
        processor.previewDrum ((int) message["drum"], (float) (double) message.getProperty ("vel", 0.9));
    }
    else if (type == "saveFile")
    {
        saveMidiFile (message["name"].toString(), message["data"].toString());
    }
}

void StudioEditor::sendSessionToPage()
{
    if (! pageReady) return;
    const auto session = processor.getSession();
    if (session.isEmpty()) return;

    // Small chunks, for the same reason the page chunks its messages.
    constexpr int chunkSize = 3000;
    const auto count = (session.length() + chunkSize - 1) / chunkSize;
    for (int i = 0; i < count; ++i)
    {
        auto* part = new juce::DynamicObject();
        part->setProperty ("i", i);
        part->setProperty ("n", count);
        part->setProperty ("data", session.substring (i * chunkSize, (i + 1) * chunkSize));
        web.emitEventIfBrowserIsVisible ("restoreChunk", juce::var (part));
    }
}

void StudioEditor::saveMidiFile (const juce::String& name, const juce::String& base64)
{
    auto data = std::make_shared<juce::MemoryBlock>();
    {
        juce::MemoryOutputStream stream (*data, false);
        juce::Base64::convertFromBase64 (stream, base64);
    }
    if (data->isEmpty()) return;

    const auto start = juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile (name);
    chooser = std::make_unique<juce::FileChooser> ("Save MIDI file", start, "*.mid");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                              | juce::FileBrowserComponent::warnAboutOverwriting,
                          [data] (const juce::FileChooser& fc)
                          {
                              auto file = fc.getResult();
                              if (file == juce::File()) return;
                              if (! file.hasFileExtension ("mid")) file = file.withFileExtension ("mid");
                              file.replaceWithData (data->getData(), data->getSize());
                          });
}

void StudioEditor::timerCallback()
{
    if (! pageReady) return;
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("q", processor.reportedQ.load());
    obj->setProperty ("bpm", processor.reportedBpm.load());
    obj->setProperty ("playing", processor.reportedPlaying.load());
    obj->setProperty ("host", processor.reportedHost.load());
    web.emitEventIfBrowserIsVisible ("position", juce::var (obj));
}
