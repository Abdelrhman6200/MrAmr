#!/bin/sh
# Hosting platforms (Railway, Render, Fly…) mount the persistent disk owned by root.
# Start as root just long enough to make the data folder writable, then run the app
# as the unprivileged `node` user.
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
