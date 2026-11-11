#!/bin/sh
set -eu
here=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
cd "$here"
exec "$here/runtime/node" "$here/launch.mjs" "$@"
