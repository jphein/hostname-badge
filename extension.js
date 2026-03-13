import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const LOCAL_HOSTNAME = GLib.get_host_name();

// Cache for SSH hostnames per window PID
const sshHostnameCache = new Map();

// Terminal app WM classes
const TERMINAL_CLASSES = [
    'gnome-terminal', 'gnome-terminal-server', 'tilix', 'kitty',
    'alacritty', 'terminator', 'konsole', 'xterm', 'urxvt',
    'foot', 'wezterm', 'contour', 'hyper', 'tabby'
];

// Patterns to extract hostname from title
const HOSTNAME_EXTRACT_PATTERNS = [
    /^(\w+)@([\w.-]+):/,              // user@host:
    /^([\w.-]+):\s/,                   // host:
    /\[([\w.-]+)\]$/,                  // [host]
    /\(([\w.-]+)\)$/,                  // (host)
    /^([\w.-]+)\s*[─—-]\s*/,           // host -
    /tmux:?\s*[\d:]*\s*(\w+)@([\w.-]+)/i,
    /screen\s+\d+[.:]\s*([\w.-]+)/i,
    /(\w+)@([\w.-]+)\s*\|/,
    /\|\s*(\w+)@([\w.-]+)/,
];

// Apps that override titles aggressively
const AGGRESSIVE_APPS = ['claude code', 'claude'];

// Our suffix pattern
const OUR_SUFFIX_PATTERN = /\s+\[[\w.-]+\]$/;

// Panel indicator - magical floating badge
const HostnameIndicator = GObject.registerClass(
class HostnameIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Hostname Indicator');

        this._outerBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._badge = new St.Label({
            text: `◈ ${LOCAL_HOSTNAME}`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._applyLocalStyle();

        this._outerBox.add_child(this._badge);
        this.add_child(this._outerBox);

        this._currentHost = LOCAL_HOSTNAME;
        this._isRemote = false;
        this._pulseTimeline = null;

        this._startIdlePulse();
    }

    _applyLocalStyle() {
        this._badge.style = `
            font-weight: bold;
            font-size: 12px;
            color: #8ae234;
            background-color: rgba(40, 60, 40, 0.95);
            border: 2px solid #8ae234;
            border-radius: 12px;
            padding: 3px 12px;
        `;
        this._isRemote = false;
    }

    _applyRemoteStyle() {
        this._badge.style = `
            font-weight: bold;
            font-size: 12px;
            color: #34e2e2;
            background-color: rgba(40, 60, 70, 0.95);
            border: 2px solid #34e2e2;
            border-radius: 12px;
            padding: 3px 12px;
        `;
        this._isRemote = true;
    }

    _applyBurstStyle(isRemote) {
        const color = isRemote ? '#34e2e2' : '#8ae234';
        const bg = isRemote ? 'rgba(40, 80, 90, 1)' : 'rgba(60, 90, 60, 1)';
        this._badge.style = `
            font-weight: bold;
            font-size: 13px;
            color: #ffffff;
            background-color: ${bg};
            border: 3px solid ${color};
            border-radius: 14px;
            padding: 4px 14px;
        `;
    }

    _startIdlePulse() {
        if (this._pulseTimeline) {
            this._pulseTimeline.stop();
            this._pulseTimeline = null;
        }

        this._pulseTimeline = new Clutter.Timeline({
            duration: 2500,
            repeat_count: -1,
            actor: this._badge,
        });

        this._pulseTimeline.connect('new-frame', () => {
            const progress = this._pulseTimeline.get_progress();
            const pulse = Math.sin(progress * Math.PI * 2) * 0.2 + 0.8;
            this._badge.opacity = Math.floor(pulse * 255);
        });

        this._pulseTimeline.start();
    }

    _triggerHostChangeGlow(isRemote) {
        if (this._pulseTimeline) {
            this._pulseTimeline.stop();
            this._pulseTimeline = null;
        }

        this._applyBurstStyle(isRemote);
        this._badge.opacity = 255;

        this._badge.ease({
            scale_x: 1.15,
            scale_y: 1.15,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._badge.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => {
                        if (isRemote) this._applyRemoteStyle();
                        else this._applyLocalStyle();
                        this._startIdlePulse();
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
        super.destroy();
    }
});

// Detect SSH hostname via foreground process state
function detectSshHostname(win, forceRefresh = false) {
    try {
        const pid = win.get_pid();
        if (!pid || pid <= 0) return null;

        const cacheKey = pid;
        const cached = sshHostnameCache.get(cacheKey);
        if (!forceRefresh && cached && (Date.now() - cached.time) < 500) {
            return cached.hostname;
        }

        // Find foreground SSH (S+ = active tab), fallback to any SSH
        const [ok, stdout] = GLib.spawn_command_line_sync(
            `bash -c "ps -eo stat,args | grep -E '^[SR]\\+' | grep '[s]sh ' | head -1 || ps -eo args | grep '[s]sh ' | grep -v grep | tail -1"`
        );

        let hostname = null;

        if (ok && stdout && stdout.length > 0) {
            const output = new TextDecoder().decode(stdout).trim();
            const sshMatch = output.match(/ssh\s+(?:-\S+\s+)*(?:[\w-]+@)?([\w.-]+)/);
            if (sshMatch && sshMatch[1]) {
                hostname = sshMatch[1];
            }
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
                const candidate = match[i];
                if (candidate &&
                    candidate.length > 1 &&
                    !candidate.match(/^\d+$/) &&
                    candidate.match(/^[\w.-]+$/)) {
                    if (candidate.includes('.') || candidate.length <= 15) {
                        return candidate;
                    }
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
        const forceRefresh = isAggressiveApp(title);
        const sshHost = detectSshHostname(win, forceRefresh);
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
        this._indicator = null;
        this._windowTracker = null;
    }

    _updateWindow(win) {
        if (!win || !isTerminalWindow(win)) return;

        const realTitle = win._hostnameOriginalGetTitle
            ? win._hostnameOriginalGetTitle()
            : win.get_title();

        if (!realTitle) return;

        if (win === global.display.get_focus_window() && this._indicator) {
            const host = getEffectiveHostname(realTitle, win);
            this._indicator.setHost(host);
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
            console.log(`hostname-in-title: Error connecting window: ${e}`);
        }
    }

    enable() {
        this._windowTracker = Shell.WindowTracker.get_default();

        this._indicator = new HostnameIndicator();
        Main.panel.addToStatusArea('hostname-indicator', this._indicator, -1, 'right');

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
            } else if (this._indicator) {
                this._indicator.setHost(LOCAL_HOSTNAME);
            }
        });
        this._connections.push({ obj: global.display, id: focusId });

        const destroyId = global.window_manager.connect('destroy', (_, actor) => {
            this._cleanupWindow(actor.meta_window);
        });
        this._connections.push({ obj: global.window_manager, id: destroyId });
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
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
