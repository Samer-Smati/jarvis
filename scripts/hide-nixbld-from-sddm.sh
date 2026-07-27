#!/usr/bin/env bash
set -euo pipefail
# Hide Nix build users (and other nologin system accounts) from the SDDM user list.
# Does NOT delete them — Nix multi-user builds still need nixbld*.

sudo mkdir -p /etc/sddm.conf.d
sudo tee /etc/sddm.conf.d/hide-system-users.conf >/dev/null <<'CONF'
[Users]
HideShells=/sbin/nologin,/usr/sbin/nologin,/bin/false,/usr/bin/nologin
MinimumUid=1000
CONF

echo "Wrote /etc/sddm.conf.d/hide-system-users.conf"
echo "Log out (or reboot) to refresh the user switcher."
echo "nixbld* users remain for Nix — they just won't appear in the UI."
