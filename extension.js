import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const LOCAL_HOSTNAME = GLib.get_host_name();
const sshHostnameCache = new Map();

const TERMINAL_CLASSES = [
    'gnome-terminal', 'gnome-terminal-server', 'tilix', 'kitty',
    'alacritty', 'terminator', 'konsole', 'xterm', 'urxvt',
    'foot', 'wezterm', 'contour', 'hyper', 'tabby'
];

const HOSTNAME_EXTRACT_PATTERNS = [
    /^(\w+)@([\w.-]+):/,
    /^([\w.-]+):\s/,
    /\[([\w.-]+)\]$/,
    /\(([\w.-]+)\)$/,
    /^([\w.-]+)\s*[─—-]\s*/,
    /tmux:?\s*[\d:]*\s*(\w+)@([\w.-]+)/i,
    /screen\s+\d+[.:]\s*([\w.-]+)/i,
    /(\w+)@([\w.-]+)\s*\|/,
    /\|\s*(\w+)@([\w.-]+)/,
];

const AGGRESSIVE_APPS = ['claude code', 'claude'];
const OUR_SUFFIX_PATTERN = /\s+\[[\w.-]+\]$/;

// Settings file for position persistence
const SETTINGS_PATH = GLib.get_home_dir() + '/.config/hostname-badge-position.json';

function loadPosition() {
    try {
        const [ok, contents] = GLib.file_get_contents(SETTINGS_PATH);
        if (ok) {
            return JSON.parse(new TextDecoder().decode(contents));
        }
    } catch (e) {}
    return { x: -1, y: 8 }; // default: top-right area
}

function savePosition(x, y) {
    try {
        const data = JSON.stringify({ x, y });
        GLib.file_set_contents(SETTINGS_PATH, data);
    } catch (e) {}
}

// Magical floating badge
const HostnameBadge = GObject.registerClass(
class HostnameBadge extends St.Widget {
    _init() {
        super._init({
            reactive: true,
            can_focus: true,
            track_hover: true,
            layout_manager: new Clutter.BinLayout(),
        });

        // Outer glow ring
        this._glowRing = new St.Widget({
            style: `
                background-color: rgba(138, 226, 52, 0.15);
                border: 1px solid rgba(138, 226, 52, 0.25);
                border-radius: 18px;
            `,
        });
        this.add_child(this._glowRing);

        // Middle glow
        this._midGlow = new St.Widget({
            style: `
                background-color: rgba(138, 226, 52, 0.08);
                border-radius: 15px;
            `,
        });
        this.add_child(this._midGlow);

        // Badge label
        this._badge = new St.Label({
            text: `◈ ${LOCAL_HOSTNAME}`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._applyLocalStyle();
        this.add_child(this._badge);

        this._currentHost = LOCAL_HOSTNAME;
        this._isRemote = false;
        this._pulseTimeline = null;
        this._glowPulseTimeline = null;
        this._dragging = false;

        // Enable drag
        this._dragMonitor = null;
        this._dragStartX = 0;
        this._dragStartY = 0;

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('button-release-event', this._onButtonRelease.bind(this));
        this.connect('motion-event', this._onMotion.bind(this));

        this._startIdlePulse();
        this._startGlowPulse();
    }

    _onButtonPress(actor, event) {
        if (event.get_button() === 1) {
            this._dragging = true;
            const [stageX, stageY] = event.get_coords();
            this._dragStartX = stageX - this.x;
            this._dragStartY = stageY - this.y;
            // Visual feedback
            this._badge.ease({
                scale_x: 1.1,
                scale_y: 1.1,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonRelease(actor, event) {
        if (this._dragging) {
            this._dragging = false;
            savePosition(this.x, this.y);
            this._badge.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            });
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(actor, event) {
        if (this._dragging) {
            const [stageX, stageY] = event.get_coords();
            this.set_position(
                Math.max(0, stageX - this._dragStartX),
                Math.max(0, stageY - this._dragStartY)
            );
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _applyLocalStyle() {
        this._badge.style = `
            font-weight: bold;
            font-size: 13px;
            color: #8ae234;
            background-color: rgba(20, 35, 20, 0.92);
            border: 2px solid rgba(138, 226, 52, 0.7);
            border-radius: 14px;
            padding: 5px 16px;
        `;
        this._glowRing.style = `
            background-color: rgba(138, 226, 52, 0.12);
            border: 1px solid rgba(138, 226, 52, 0.2);
            border-radius: 20px;
            padding: 6px;
        `;
        this._midGlow.style = `
            background-color: rgba(138, 226, 52, 0.06);
            border-radius: 17px;
            padding: 3px;
        `;
        this._isRemote = false;
    }

    _applyRemoteStyle() {
        this._badge.style = `
            font-weight: bold;
            font-size: 13px;
            color: #34e2e2;
            background-color: rgba(20, 30, 40, 0.92);
            border: 2px solid rgba(52, 226, 226, 0.7);
            border-radius: 14px;
            padding: 5px 16px;
        `;
        this._glowRing.style = `
            background-color: rgba(52, 226, 226, 0.12);
            border: 1px solid rgba(52, 226, 226, 0.2);
            border-radius: 20px;
            padding: 6px;
        `;
        this._midGlow.style = `
            background-color: rgba(52, 226, 226, 0.06);
            border-radius: 17px;
            padding: 3px;
        `;
        this._isRemote = true;
    }

    _applyBurstStyle(isRemote) {
        const c = isRemote ? '52, 226, 226' : '138, 226, 52';
        this._badge.style = `
            font-weight: bold;
            font-size: 14px;
            color: #ffffff;
            background-color: rgba(${c}, 0.25);
            border: 3px solid rgba(${c}, 1);
            border-radius: 16px;
            padding: 6px 18px;
        `;
        this._glowRing.style = `
            background-color: rgba(${c}, 0.35);
            border: 2px solid rgba(${c}, 0.6);
            border-radius: 22px;
            padding: 8px;
        `;
        this._midGlow.style = `
            background-color: rgba(${c}, 0.2);
            border-radius: 19px;
            padding: 4px;
        `;
    }

    _startIdlePulse() {
        if (this._pulseTimeline) {
            this._pulseTimeline.stop();
            this._pulseTimeline = null;
        }

        this._pulseTimeline = new Clutter.Timeline({
            duration: 3000,
            repeat_count: -1,
            actor: this._badge,
        });

        this._pulseTimeline.connect('new-frame', () => {
            const p = this._pulseTimeline.get_progress();
            // Smooth breathing: slow in, slow out
            const breath = Math.sin(p * Math.PI * 2) * 0.15 + 0.85;
            this._badge.opacity = Math.floor(breath * 255);
        });

        this._pulseTimeline.start();
    }

    _startGlowPulse() {
        if (this._glowPulseTimeline) {
            this._glowPulseTimeline.stop();
            this._glowPulseTimeline = null;
        }

        this._glowPulseTimeline = new Clutter.Timeline({
            duration: 4000,
            repeat_count: -1,
            actor: this._glowRing,
        });

        this._glowPulseTimeline.connect('new-frame', () => {
            const p = this._glowPulseTimeline.get_progress();
            // Offset from badge pulse for layered effect
            const glow = Math.sin(p * Math.PI * 2 + 1.5) * 0.3 + 0.7;
            this._glowRing.opacity = Math.floor(glow * 255);
            this._midGlow.opacity = Math.floor(glow * 200);
        });

        this._glowPulseTimeline.start();
    }

    _triggerHostChangeGlow(isRemote) {
        // Stop all pulses
        if (this._pulseTimeline) {
            this._pulseTimeline.stop();
            this._pulseTimeline = null;
        }
        if (this._glowPulseTimeline) {
            this._glowPulseTimeline.stop();
            this._glowPulseTimeline = null;
        }

        // Burst!
        this._applyBurstStyle(isRemote);
        this._badge.opacity = 255;
        this._glowRing.opacity = 255;
        this._midGlow.opacity = 255;

        // Scale burst on all layers
        this.ease({
            scale_x: 1.25,
            scale_y: 1.25,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                this.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 600,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => {
                        if (isRemote) this._applyRemoteStyle();
                        else this._applyLocalStyle();
                        this._startIdlePulse();
                        this._startGlowPulse();
                    }
                });
            }
        });
    }

    setHost(hostname) {
        if (!hostname) hostname = LOCAL_HOSTNAME;

        const isRemote = hostname !== LOCAL_HOSTNAME;
        const symbol = isRemote ? '⟐' : '◈';
        const display = `${symbol} ${hostname}`;

        const hostChanged = this._currentHost !== hostname;
        this._currentHost = hostname;

        this._badge.set_text(display);

        if (hostChanged) {
            this._triggerHostChangeGlow(isRemote);
        } else if (isRemote !== this._isRemote) {
            if (isRemote) this._applyRemoteStyle();
            else this._applyLocalStyle();
        }
    }

    destroy() {
        if (this._pulseTimeline) {
            this._pulseTimeline.stop();
            this._pulseTimeline = null;
        }
        if (this._glowPulseTimeline) {
            this._glowPulseTimeline.stop();
            this._glowPulseTimeline = null;
        }
        super.destroy();
    }
});

// --- SSH detection and title logic (unchanged) ---

function detectSshHostname(win, forceRefresh = false) {
    try {
        const pid = win.get_pid();
        if (!pid || pid <= 0) return null;

        const cacheKey = pid;
        const cached = sshHostnameCache.get(cacheKey);
        if (!forceRefresh && cached && (Date.now() - cached.time) < 500) {
            return cached.hostname;
        }

        const [ok, stdout] = GLib.spawn_command_line_sync(
            `bash -c "ps -eo stat,args | grep -E '^[SR]\\+' | grep '[s]sh ' | head -1 || ps -eo args | grep '[s]sh ' | grep -v grep | tail -1"`
        );

        let hostname = null;
        if (ok && stdout && stdout.length > 0) {
            const output = new TextDecoder().decode(stdout).trim();
            const sshMatch = output.match(/ssh\s+(?:-\S+\s+)*(?:[\w-]+@)?([\w.-]+)/);
            if (sshMatch && sshMatch[1]) hostname = sshMatch[1];
        }

        sshHostnameCache.set(cacheKey, { hostname, time: Date.now() });
        return hostname;
    } catch (e) {
        return null;
    }
}

function extractHostnameFromTitle(title) {
    if (!title) return null;
    for (const pattern of HOSTNAME_EXTRACT_PATTERNS) {
        const match = title.match(pattern);
        if (match) {
            for (let i = match.length - 1; i >= 1; i--) {
                const c = match[i];
                if (c && c.length > 1 && !c.match(/^\d+$/) && c.match(/^[\w.-]+$/)) {
                    if (c.includes('.') || c.length <= 15) return c;
                }
            }
        }
    }
    return null;
}

function isAggressiveApp(title) {
    if (!title) return false;
    const lower = title.toLowerCase();
    return AGGRESSIVE_APPS.some(app => lower === app || lower.startsWith(app + ' '));
}

function isTerminalWindow(win) {
    if (!win) return false;
    const wmClass = win.get_wm_class();
    if (!wmClass) return false;
    const lower = wmClass.toLowerCase();
    return TERMINAL_CLASSES.some(tc => lower.includes(tc));
}

function getEffectiveHostname(title, win = null) {
    const extracted = extractHostnameFromTitle(title);
    if (extracted) return extracted;
    if (win) {
        const sshHost = detectSshHostname(win, isAggressiveApp(title));
        if (sshHost) return sshHost;
    }
    return LOCAL_HOSTNAME;
}

function shouldModifyTitle(title) {
    if (!title) return false;
    if (OUR_SUFFIX_PATTERN.test(title)) return false;
    if (isAggressiveApp(title)) return true;
    if (extractHostnameFromTitle(title)) return false;
    return true;
}

function buildModifiedTitle(originalTitle, win = null) {
    if (!originalTitle) return originalTitle;
    const cleanTitle = originalTitle.replace(OUR_SUFFIX_PATTERN, '');
    const hostname = getEffectiveHostname(cleanTitle, win);
    return `${cleanTitle} [${hostname}]`;
}

export default class HostnameInTitleExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._connections = [];
        this._titleConnections = new Map();
        this._badge = null;
        this._windowTracker = null;
    }

    _updateWindow(win) {
        if (!win || !isTerminalWindow(win)) return;

        const realTitle = win._hostnameOriginalGetTitle
            ? win._hostnameOriginalGetTitle()
            : win.get_title();
        if (!realTitle) return;

        if (win === global.display.get_focus_window() && this._badge) {
            const host = getEffectiveHostname(realTitle, win);
            this._badge.setHost(host);
        }

        if (!shouldModifyTitle(realTitle)) {
            if (win._hostnameOriginalGetTitle && !isAggressiveApp(realTitle)) {
                win.get_title = win._hostnameOriginalGetTitle;
                delete win._hostnameOriginalGetTitle;
            }
            return;
        }

        if (!win._hostnameOriginalGetTitle) {
            win._hostnameOriginalGetTitle = win.get_title.bind(win);
            const capturedWin = win;
            win.get_title = function() {
                const orig = capturedWin._hostnameOriginalGetTitle();
                if (!orig) return orig;
                if (!shouldModifyTitle(orig)) return orig;
                return buildModifiedTitle(orig, capturedWin);
            };
        }
    }

    _cleanupWindow(win) {
        if (!win) return;
        if (this._titleConnections.has(win)) {
            try { win.disconnect(this._titleConnections.get(win)); } catch (e) {}
            this._titleConnections.delete(win);
        }
        if (win._hostnameOriginalGetTitle) {
            try { win.get_title = win._hostnameOriginalGetTitle; } catch (e) {}
            delete win._hostnameOriginalGetTitle;
        }
    }

    _connectWindow(win) {
        if (!win || this._titleConnections.has(win)) return;
        if (!isTerminalWindow(win)) return;
        try {
            const id = win.connect('notify::title', () => this._updateWindow(win));
            this._titleConnections.set(win, id);
            this._updateWindow(win);
        } catch (e) {
            console.log(`hostname-in-title: Error: ${e}`);
        }
    }

    enable() {
        this._windowTracker = Shell.WindowTracker.get_default();

        // Create floating badge
        this._badge = new HostnameBadge();
        Main.layoutManager.addChrome(this._badge, {
            affectsInputRegion: true,
            trackFullscreen: true,
        });

        // Position from saved settings or default
        const pos = loadPosition();
        if (pos.x < 0) {
            // Default: top-right, near panel
            const monitor = Main.layoutManager.primaryMonitor;
            this._badge.set_position(monitor.width - 180, 8);
        } else {
            this._badge.set_position(pos.x, pos.y);
        }

        // Connect existing windows
        for (const actor of global.get_window_actors()) {
            this._connectWindow(actor.meta_window);
        }

        const windowCreatedId = global.display.connect('window-created', (_, win) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                this._connectWindow(win);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._connections.push({ obj: global.display, id: windowCreatedId });

        const focusId = global.display.connect('notify::focus-window', () => {
            const win = global.display.get_focus_window();
            if (win && isTerminalWindow(win)) {
                this._updateWindow(win);
            } else if (this._badge) {
                this._badge.setHost(LOCAL_HOSTNAME);
            }
        });
        this._connections.push({ obj: global.display, id: focusId });

        const destroyId = global.window_manager.connect('destroy', (_, actor) => {
            this._cleanupWindow(actor.meta_window);
        });
        this._connections.push({ obj: global.window_manager, id: destroyId });
    }

    disable() {
        if (this._badge) {
            Main.layoutManager.removeChrome(this._badge);
            this._badge.destroy();
            this._badge = null;
        }

        for (const conn of this._connections) {
            try { conn.obj.disconnect(conn.id); } catch (e) {}
        }
        this._connections = [];

        for (const actor of global.get_window_actors()) {
            this._cleanupWindow(actor.meta_window);
        }
        this._titleConnections.clear();
        this._windowTracker = null;
    }
}
