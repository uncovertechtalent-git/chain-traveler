#!/bin/sh
# Serve the app locally on http://localhost:8765 (the data must be built first, see README).
cd "$(dirname "$0")/app" && exec python3 -m http.server 8765 --bind 127.0.0.1
