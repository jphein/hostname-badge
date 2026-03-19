# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A GNOME Shell extension (`hostname-in-title@local`) that displays a floating, draggable badge showing the hostname of the active terminal session. It detects SSH sessions from terminal window titles and visually distinguishes local (green) vs remote (cyan) hosts.

Part of JP's GNOME extension pack.

## Deploy & Test

```bash
./deploy.sh              # copies to ~/.local/share/gnome-shell/extensions/hostname-in-title@local
```

After deploying, log out/in to reload GNOME Shell (or `Alt+F2` → `r` on X11). There is no build step, linter, or test suite.

To check for runtime errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell   # live GNOME Shell logs
```

## Architecture

This is a single-file extension. Everything lives in `extension.js` (~570 lines).

**Key components:**

- **`HostnameBadge`** (GObject class, lines 56-346) — The floating UI widget. Three nested layers (glow ring → mid glow → label) with Clutter animation timelines for idle pulse, glow pulse, and host-change burst. Handles its own drag events and persists position to `~/.config/hostname-badge-position.json`.

- **Hostname detection** (lines 350-420) — `extractHostnameFromTitle()` runs 9 regex patterns against window titles. `detectSshHostname()` uses `pstree` as a fallback but is unreliable with GNOME Terminal tabs (shared PID). Title-based detection is the primary path.

- **Window title patching** (lines 422-476) — Monkey-patches `win.get_title()` on terminal windows to append `[hostname]`. Stores the original method as `win._hostnameOriginalGetTitle` and restores it on cleanup.

- **`HostnameInTitleExtension`** (lines 437-570) — The extension lifecycle class. `enable()` creates the badge, connects to `window-created`/`notify::focus-window`/`destroy` signals. `disable()` tears everything down and restores patched windows.

**Signal flow:** focus-window change → `_updateWindow()` → reads title → `getEffectiveHostname()` → `badge.setHost()` → style/animation update.

## GNOME Extension Conventions

- Uses ES module imports (`import ... from 'gi://...'`), required for GNOME 45+.
- `metadata.json` defines UUID, shell version compatibility (45-47), and version number.
- All UI styling is inline on St.Widget `style` properties (no `stylesheet.css`).
- The extension must cleanly disconnect all signals and destroy all actors in `disable()` — GNOME enforces this.
