#!/bin/sh
# Gives the server a 2 GB swap file if it has none, so a memory spike (ClamAV reloading its virus list, a Docker build)
# slows the server down instead of freezing it. The 1 GB Lightsail server froze this way on 30 Oct 2026.
# Safe to run on every deploy: it does nothing when swap is already on. Run as root (sudo sh deploy/ensure-swap.sh).
set -eu
if [ -n "$(swapon --show --noheadings 2>/dev/null)" ]; then echo "swap already on"; exit 0; fi
[ -f /swapfile ] || { fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048; }
chmod 600 /swapfile
mkswap /swapfile >/dev/null
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Use swap only when memory is really short, so normal requests stay fast
sysctl -q vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
echo "swap on: $(swapon --show --noheadings)"
