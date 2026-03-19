#!/bin/bash
# Deploy extension from source to GNOME Shell
SRC="$HOME/Projects/hostname-badge"
DEST="$HOME/.local/share/gnome-shell/extensions/hostname-in-title@local"

rm -rf "$DEST"
cp -r "$SRC" "$DEST"
rm -rf "$DEST/.git" "$DEST/.gitignore" "$DEST/deploy.sh" "$DEST/README.md" "$DEST/CLAUDE.md"
echo "Deployed. Log out/in to reload."
