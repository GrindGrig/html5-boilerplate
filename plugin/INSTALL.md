# Sonata plugin

An instrument plugin (VST3, plus AU on macOS) with the full Sonata app
inside the plugin window. It plays in sync with your DAW's tempo and
transport, and sends everything out as MIDI too.

## Install

**macOS**

1. Copy `Sonata.vst3` to `~/Library/Audio/Plug-Ins/VST3/`
   and `Sonata.component` to
   `~/Library/Audio/Plug-Ins/Components/` (for Logic Pro and GarageBand).
2. The plugin is not code-signed, so macOS blocks it at first. Open Terminal
   and run:

   ```
   xattr -cr ~/Library/Audio/Plug-Ins/VST3/"Sonata.vst3"
   xattr -cr ~/Library/Audio/Plug-Ins/Components/"Sonata.component"
   ```

3. Restart your DAW (Logic: it rescans Audio Units on launch).

**Windows**

1. Copy the `Sonata.vst3` folder to
   `C:\Program Files\Common Files\VST3\`.
2. Rescan plugins in your DAW. The plugin window uses Microsoft Edge
   WebView2, which is built into Windows 10 and 11.

**Linux**

Copy `Sonata.vst3` to `~/.vst3/`. The window needs
`libwebkit2gtk-4.1` (installed on most desktops).

There is also a standalone app in each download for trying it without a DAW.

## Use it in your DAW

1. Add **Sonata** to an instrument track.
2. Generate a melody, chord progression or ensemble, and set up the drums,
   exactly as in the browser version.
3. Press play in the DAW. The song and drums follow the DAW's tempo and
   start from bar 1 of the project, looping. With the DAW stopped, the Play
   buttons in the plugin window preview the parts.
4. To put the notes on your own tracks, drag **Drag song + drums MIDI** or
   **Drag drums MIDI** from the strip at the bottom of the window onto a
   track. The Download buttons save `.mid` files.
5. To play your own instruments live, route the plugin's MIDI output: each
   part gets its own channel in the order the legend shows (channel 1, 2, 3 …,
   skipping 10), backing chords take the next one, and drums are on channel 10
   (General MIDI drum notes). Turn off **Built-in sound** to hear only your
   instruments.

Everything you set up is saved with the DAW project.

## Build from source

Needs CMake 3.22+ and a C++17 compiler; JUCE 8 is downloaded automatically.

```
cmake -S plugin -B plugin/build -DCMAKE_BUILD_TYPE=Release
cmake --build plugin/build --config Release
```

The plugin window shows the web app from `dist/` (rebuilt by `npm test`),
so rebuild the plugin after changing `src/`. Add `-DMDS_BUILD_TESTS=ON` and
run `StudioTests plugin/Tests/state.json` for the headless processor tests.

On Windows, install the WebView2 SDK first (see `.github/workflows/plugin.yml`)
and pass `-DJUCE_WEBVIEW2_PACKAGE_LOCATION=<folder>`.

JUCE is licensed under AGPLv3 or the JUCE commercial licence; check that the
licence fits before distributing builds.
