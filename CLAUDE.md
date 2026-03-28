<!-- claude-md-version: 7c5e180 | updated: 2026-03-20 -->
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A GNOME Shell extension (`hostname-in-title@local`) that displays a floating, draggable badge showing the hostname of the active terminal session. It detects SSH sessions from terminal window titles and visually distinguishes local (green) vs remote (cyan) hosts.

Part of JP's GNOME extension pack.

## Deploy & Test

```bash
./install.sh             # copies files, compiles schemas, enables extension
./install.sh --uninstall # removes extension and disables it
```

After installing, log out/in to reload GNOME Shell (or `Alt+F2` → `r` on X11). There is no build step, linter, or test suite.

To check for runtime errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell   # live GNOME Shell logs
```

## File Map

| File | Role |
|------|------|
| `extension.js` | Main extension: badge widget, SSH detection, window title patching |
| `stylesheet.css` | All badge styles: local (green), remote (cyan), burst animations |
| `prefs.js` | Adw.PreferencesPage: pulse, opacity, position reset |
| `metadata.json` | Extension UUID, shell versions (45-48), GSettings schema ref |
| `schemas/*.gschema.xml` | GSettings: position-x, position-y, enable-pulse, badge-opacity |
| `install.sh` | Installer/uninstaller (copy files, compile schemas, enable) |
| `deploy.sh` | Legacy deploy script (use install.sh instead) |

## Architecture

**Key components:**

- **`HostnameBadge`** (GObject class) — The floating UI widget. Three nested layers (glow ring → mid glow → label) with Clutter animation timelines for idle pulse, glow pulse, and host-change burst. Handles drag events and persists position via GSettings.

- **Hostname detection** — `extractHostnameFromTitle()` runs 9 regex patterns against window titles. `detectSshHostname()` uses `pstree` as a fallback but is unreliable with GNOME Terminal tabs (shared PID). Title-based detection is the primary path.

- **Window title patching** — Monkey-patches `win.get_title()` on terminal windows to append `[hostname]`. Stores the original method as `win._hostnameOriginalGetTitle` and restores it on cleanup.

- **`HostnameInTitleExtension`** — The extension lifecycle class. `enable()` creates the badge, connects to `window-created`/`notify::focus-window`/`destroy` signals. `disable()` tears everything down and restores patched windows.

**Signal flow:** focus-window change → `_updateWindow()` → reads title → `getEffectiveHostname()` → `badge.setHost()` → style_class swap + animation.

## GNOME Extension Conventions

- Uses ES module imports (`import ... from 'gi://...'`), required for GNOME 45+.
- `metadata.json` defines UUID, shell version compatibility (45-48), settings-schema, and version number.
- UI styling uses `style_class` references to `stylesheet.css` (no inline styles).
- Position and preferences stored in GSettings (`org.gnome.shell.extensions.hostname-badge`).
- The extension must cleanly disconnect all signals and destroy all actors in `disable()` — GNOME enforces this.
