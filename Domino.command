#!/bin/zsh
# Double-click this file to start Domino. Close the Terminal window to stop it.
cd "$(dirname "$0")"
exec python3 server.py
