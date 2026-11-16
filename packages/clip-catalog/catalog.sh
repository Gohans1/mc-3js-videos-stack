#!/usr/bin/env bash
exec python "$(dirname "$0")/batch.py" catalog "$@"
