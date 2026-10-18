#!/bin/sh
set -eu
# Existing volumes were created by the former Nginx-only deployment.
mkdir -p /data/projects
chown -R node:node /data
exec su-exec node:node "$@"
