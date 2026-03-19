# Hostname Badge

A GNOME Shell extension that displays a floating, draggable badge showing the hostname of your active terminal session. When you SSH into a remote machine, the badge automatically detects the remote hostname and switches from green (local) to cyan (remote) with a burst animation.

Part of the [JP Extension Pack](https://github.com/jphein).

## What It Does

- Shows a glowing badge on your desktop with the current hostname
- Detects SSH sessions from terminal window titles and updates in real time
- Color-codes local vs remote: **green** for local, **cyan** for remote
- Animated transitions when switching between hosts
- Drag the badge anywhere on screen; position is saved between sessions

## Supported Terminals

gnome-terminal, tilix, kitty, alacritty, terminator, konsole, xterm, urxvt, foot, wezterm, contour, hyper, tabby

## Install

```bash
./deploy.sh
```

Then log out and back in (or press `Alt+F2`, type `r`, Enter on X11).

Enable with GNOME Extensions app or:

```bash
gnome-extensions enable hostname-in-title@local
```

## How Hostname Detection Works

The extension reads terminal window titles and matches against common prompt formats:

| Pattern | Example |
|---|---|
| `user@host:` | `jp@server01:~/code` |
| `[host]` | `[prod-web-3]` |
| `(host)` | `(staging-db)` |
| `host -- cmd` | `server01 -- vim` |
| `tmux` sessions | `tmux:0:jp@server01` |

If no hostname is found in the title, it falls back to the local hostname.

### Shell Prompt Setup

For best results with SSH detection, configure your remote shell prompt to include `user@hostname` in the terminal title. Add this to your remote `.bashrc`:

```bash
PROMPT_COMMAND='echo -ne "\033]0;${USER}@${HOSTNAME%%.*}:${PWD/#$HOME/\~}\007"'
```

### GNOME Terminal Tabs

GNOME Terminal shares a single process for all tabs, so SSH process-tree detection doesn't work per-tab. Title-based detection handles this correctly as long as your prompt sets the terminal title.

If using Claude Code, set `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` so the extension can read your shell prompt title instead.

## Configuration

**Badge position** is saved to `~/.config/hostname-badge-position.json`. Delete this file to reset to the default position (top-right corner).

No other settings. The extension is designed to work out of the box.

## Compatibility

- GNOME Shell 45, 46, 47
- Wayland and X11

## Uninstall

```bash
rm -rf ~/.local/share/gnome-shell/extensions/hostname-in-title@local
```

Then log out/in or restart GNOME Shell.
