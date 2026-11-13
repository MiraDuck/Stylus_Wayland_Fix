# Stylus Wayland Fix

An Obsidian plugin that removes the stray line drawn at the start of every pen stroke when Obsidian runs natively on Wayland (`--ozone-platform=wayland`).

## The problem

On native Wayland (seen on KDE Plasma 6 with a Wacom HID pen), the pen's `pointerdown` event arrives with the pointer's old position. Drawing plugins such as Excalidraw then draw a short line from that old position to where the pen actually touched. The same setup works fine under XWayland and in Firefox.

Forum report: [Pen stylus: stray line at the start of every stroke on native Wayland KDE Plasma](https://forum.obsidian.md/t/pen-stylus-stray-line-at-the-start-of-every-stroke-on-native-wayland-kde-plasma-not-a-problem-under-xwayland/119374)

## How it works

The plugin holds back the pen's `pointerdown` event. When the first `pointermove` (or `pointerup`, for taps) arrives, it replays the `pointerdown` at that position instead, so the stroke starts where the pen really is. Mouse and touch input are not affected.

## Settings

| Setting | Description |
| --- | --- |
| Enable fix | Turns the fix on or off. |
| Moves to skip | Pen moves to discard after touch-down before the stroke starts. Default 0. Raise it if a short stray line remains. |
| Show in status bar | Clickable on/off indicator. |
| Log pen events | Logs pen down, up, cancel and the first moves after touch-down to the console. |
| Moves to log after touch-down | How many moves to log per stroke. |
| Log stroke-start jump | Logs the distance between touch-down and the first move. |
| Show jump as notice | Shows that distance as a popup instead of only in the console. |

Open the developer console with `Ctrl+Shift+I` to see log output.

## Commands

- Toggle fix
- Toggle pen event logging
- Toggle stroke-start jump logging

## Installation

### Manual

1. Download `main.js` and `manifest.json` from the latest [release](../../releases).
2. Put them in `<vault>/.obsidian/plugins/stylus-wayland-fix/`.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

### BRAT

Add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to get updates automatically.

## Finding the right setting

1. Turn on **Log stroke-start jump** and **Show jump as notice**, and turn the fix off.
2. Draw a few strokes. Large jumps (tens of pixels) confirm the bug.
3. Turn the fix on and draw again. If you still see a short stray line, raise **Moves to skip** one step at a time.

## License

[MIT](LICENSE)
