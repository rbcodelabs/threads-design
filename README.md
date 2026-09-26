# Design for Agent Threads

Desktop-only peer plugin that adds static UI design artifacts to Agent Threads.

## Requirements

- Agent Threads v0.43.0 or later, with public API v1 and the `threads.beginProvisional` capability
- Obsidian or Geode desktop with a local filesystem vault

Interactive preview and screenshot capture require Geode's artifact runtime. In Obsidian, Preview reveals the artifact source in the file manager instead.

Enable Agent Threads first, then enable **Design for Agent Threads**. The plugin registers:

- `/design <brief>` in existing-thread and new-thread composers
- the `EnterDesignMode` agent tool
- presentation, preview, capture, and source-reveal actions for `design-static` artifacts

Artifacts use host-allocated storage beneath `.geode/artifacts/`. A failed new-thread preparation rolls back both the provisional thread and allocated storage. Once preparation commits, a later agent-session failure keeps the artifact intact and is reported to the user.

New artifacts start with a compact loading state that matches the host's current light or dark palette and interface font. This theme snapshot is captured only at creation; existing artifacts and agent-authored styles are preserved.

## Modes

A mode changes the instructions for one design turn. It does not create a new artifact kind: each thread keeps its single design artifact, and `artifact.json` is unchanged. Start the brief with a mode keyword and a colon (case-insensitive):

- `/design wireframe: a billing settings page` produces a grayscale, low-fidelity wireframe that focuses on layout, hierarchy, and flows. If the thread already has a design, the wireframe reduces it to its structure.
- `/design states: the plan-picker card` builds a component state sheet. It covers default, hover, focus-visible, pressed, disabled, loading, empty, error, and overflow states, in light and dark themes.

The colon is required, so `/design states of the union dashboard` is an ordinary brief. In a thread that already has a design, a bare `/design wireframe:` or `/design states:` runs that mode against the existing design. `EnterDesignMode` accepts the same modes through its optional `mode` argument.

## Installation

This repository is private; downloading releases requires repository access.

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/rbcodelabs/threads-design/releases/latest).
2. Put both files in `<vault>/.geode/plugins/threads-design/` for Geode, or `<vault>/.obsidian/plugins/threads-design/` for Obsidian.
3. Update and enable Agent Threads first, then enable **Design for Agent Threads** in the host's plugin settings. Restart the host if the new plugin is not listed.
4. Start a new conversation and submit `/design a simple settings page` to check the installation. Geode opens the interactive preview; Obsidian reveals the generated source.

Existing design artifacts do not need to be moved. Without this plugin, Agent Threads v0.43.0 retains source access to legacy artifacts but no longer supplies `/design` or `EnterDesignMode` itself.

## Development

```sh
npm test
npm run typecheck
npm run build
```
