cmake_minimum_required(VERSION 3.22)

project(MelodyDrumStudio VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")

# Use a local JUCE checkout with -DJUCE_DIR=/path/to/JUCE, otherwise fetch it.
set(JUCE_DIR "" CACHE PATH "Path to a JUCE 8 checkout (optional)")

if(JUCE_DIR)
    add_subdirectory(${JUCE_DIR} JUCE)
else()
    include(FetchContent)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 8.0.9
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

juce_add_plugin(MelodyDrumStudio
    COMPANY_NAME "Melody and Drum Studio"
    PRODUCT_NAME "Melody and Drum Studio"
    BUNDLE_ID com.melodydrumstudio.plugin
    PLUGIN_MANUFACTURER_CODE Mdst
    PLUGIN_CODE Mds1
    FORMATS VST3 AU Standalone
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT TRUE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
    VST3_CATEGORIES Instrument Generator
    AU_MAIN_TYPE kAudioUnitType_MusicDevice)

# The plugin window shows the same web app as the browser version, built
# into dist/ by `npm run build` (or `npm test`) at the repository root.
set(WEB_DIST ${CMAKE_CURRENT_SOURCE_DIR}/../dist)
juce_add_binary_data(StudioWebUI
    NAMESPACE StudioWeb
    SOURCES
        ${WEB_DIST}/index.html
        ${WEB_DIST}/css/style.css
        ${WEB_DIST}/css/app.css
        ${WEB_DIST}/js/app.js)

target_sources(MelodyDrumStudio PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/SoundEngine.cpp)

target_compile_definitions(MelodyDrumStudio PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(MelodyDrumStudio
    PRIVATE
        StudioWebUI
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

# Headless tests for the processor (scheduling, MIDI out, audio, state).
option(MDS_BUILD_TESTS "Build the headless processor tests" OFF)

if(MDS_BUILD_TESTS)
    juce_add_console_app(StudioTests
        PRODUCT_NAME "StudioTests"
        NEEDS_WEB_BROWSER TRUE)
    target_sources(StudioTests PRIVATE
        Tests/ProcessorTests.cpp
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        Source/SoundEngine.cpp)
    target_compile_definitions(StudioTests PRIVATE
        JucePlugin_Name="Melody and Drum Studio"
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0)
    target_link_libraries(StudioTests PRIVATE
        StudioWebUI
        juce::juce_audio_utils
        juce::juce_gui_extra
        juce::juce_recommended_config_flags)
endif()
