#!/usr/bin/env bash
# Uninstall the tbsync_bridge_host native messaging host for Thunderbird on Linux/macOS.

set -euo pipefail

if [[ "$OSTYPE" == darwin* ]]; then
  HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"
fi

INSTALL_DIR="$HOSTS_DIR/tbsync_bridge_host_helper"
MANIFEST_DEST="$HOSTS_DIR/tbsync_bridge_host.json"

echo
echo "This will uninstall the bridge helper app for the Thunderbird"
echo "add-on \"TbSync Manager Beta\"."
echo
echo "The following will happen:"
echo "  - Remove the registration file:"
echo "      $MANIFEST_DEST"
echo "  - Remove the bridge helper app from:"
echo "      $INSTALL_DIR"
echo

read -p "Proceed with uninstallation? [y/n] " -n 1 -r
echo
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Uninstallation cancelled."
  read -n1 -s -r -p "Press any key to exit..."
  echo
  echo
  exit 1
fi

if [[ -f "$MANIFEST_DEST" ]]; then
  rm "$MANIFEST_DEST"
  echo "Registration file removed:         $MANIFEST_DEST"

else
  echo "Registration file already removed: $MANIFEST_DEST"
fi

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "Removed app directory:             $INSTALL_DIR"
else
  echo "App directory already removed:     $INSTALL_DIR"
fi

echo
read -n1 -s -r -p "Press any key to exit..."
echo
echo
