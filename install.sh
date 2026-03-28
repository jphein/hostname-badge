#!/usr/bin/env bash
set -euo pipefail

UUID="hostname-in-title@local"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
PROJECT_DIR="$(dirname "$(realpath "$0")")"

G='\033[1;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'

# ── Uninstall ──
if [[ "${1:-}" == "--uninstall" || "${1:-}" == "-u" ]]; then
    echo -e "${C}${B}Hostname Badge — Uninstalling${N}"
    gnome-extensions disable "$UUID" 2>/dev/null && \
        echo -e "${G}[OK]${N} Extension disabled" || \
        echo -e "${Y}[WARN]${N} Extension was not enabled"
    if [[ -d "$INSTALL_DIR" ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${G}[OK]${N} Removed $INSTALL_DIR"
    else
        echo -e "${Y}[WARN]${N} Install directory not found"
    fi
    echo -e "\n${B}Restart GNOME Shell to finish cleanup.${N}"
    exit 0
fi

# ── Install ──
echo -e "${C}${B}Hostname Badge — Installing${N}"

# Check source files
REQUIRED=("extension.js" "metadata.json" "stylesheet.css" "schemas/org.gnome.shell.extensions.hostname-badge.gschema.xml")
MISSING=0
for f in "${REQUIRED[@]}"; do
    if [[ ! -f "$PROJECT_DIR/$f" ]]; then
        echo -e "${R}[ERR]${N} Missing: $f"
        MISSING=1
    fi
done
[[ "$MISSING" -eq 1 ]] && exit 1

# Copy extension files
mkdir -p "$INSTALL_DIR/schemas"
for f in extension.js prefs.js metadata.json stylesheet.css; do
    [[ -f "$PROJECT_DIR/$f" ]] && cp "$PROJECT_DIR/$f" "$INSTALL_DIR/$f"
done
cp "$PROJECT_DIR/schemas/"*.xml "$INSTALL_DIR/schemas/"
echo -e "${G}[OK]${N} Copied extension files to $INSTALL_DIR"

# Compile schemas
if command -v glib-compile-schemas &>/dev/null; then
    glib-compile-schemas "$INSTALL_DIR/schemas/"
    echo -e "${G}[OK]${N} Schemas compiled"
else
    echo -e "${R}[ERR]${N} glib-compile-schemas not found. Install libglib2.0-dev-bin"
    exit 1
fi

# Enable
gnome-extensions enable "$UUID" 2>/dev/null && \
    echo -e "${G}[OK]${N} Extension enabled" || \
    echo -e "${Y}[WARN]${N} Could not enable — restart GNOME Shell first"

echo
echo -e "${B}Restart GNOME Shell to load:${N}"
echo -e "  ${C}Wayland${N}: Log out and log back in"
echo -e "  ${C}X11${N}    : Alt+F2 -> r -> Enter"
echo
echo -e "${B}Uninstall:${N} $0 --uninstall"
