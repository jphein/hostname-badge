import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HostnameBadgePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Hostname Badge',
            icon_name: 'network-server-symbolic',
        });
        window.add(page);

        // ── Appearance group ──
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Badge display settings',
        });
        page.add(appearanceGroup);

        // Enable pulse animation
        const pulseRow = new Adw.SwitchRow({
            title: 'Pulse Animation',
            subtitle: 'Enable the idle breathing glow effect',
        });
        settings.bind('enable-pulse', pulseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(pulseRow);

        // Badge opacity
        const opacityRow = new Adw.SpinRow({
            title: 'Badge Opacity',
            subtitle: 'Maximum opacity (0 = invisible, 255 = fully opaque)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 255, step_increment: 5,
                value: settings.get_int('badge-opacity'),
            }),
        });
        opacityRow.connect('notify::value', () => settings.set_int('badge-opacity', opacityRow.value));
        appearanceGroup.add(opacityRow);

        // ── Position group ──
        const positionGroup = new Adw.PreferencesGroup({
            title: 'Position',
            description: 'Badge position (drag the badge to reposition, or reset here)',
        });
        page.add(positionGroup);

        // Reset position button
        const resetRow = new Adw.ActionRow({
            title: 'Reset Position',
            subtitle: 'Move badge back to default top-right corner',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetButton.connect('clicked', () => {
            settings.set_int('position-x', -1);
            settings.set_int('position-y', 8);
        });
        resetRow.add_suffix(resetButton);
        resetRow.set_activatable_widget(resetButton);
        positionGroup.add(resetRow);
    }
}
