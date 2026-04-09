#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_OPENCLAW="${PROJECT_DIR}/node_modules/.bin/openclaw"

ensure_openclaw_home() {
  export OPENCLAW_HOME="${OPENCLAW_HOME:-${PROJECT_DIR}/.openclaw-home}"
  mkdir -p "${OPENCLAW_HOME}"
}

if [[ -n "${OPENCLAW_BIN:-}" ]]; then
  if [[ ! -x "${OPENCLAW_BIN}" ]]; then
    echo "OPENCLAW_BIN is set but not executable: ${OPENCLAW_BIN}" >&2
    exit 1
  fi
  ensure_openclaw_home
  exec "${OPENCLAW_BIN}" "$@"
fi

if [[ -x "${LOCAL_OPENCLAW}" ]]; then
  ensure_openclaw_home
  exec "${LOCAL_OPENCLAW}" "$@"
fi

if [[ "${OPENCLAW_ALLOW_GLOBAL:-0}" == "1" ]] && command -v openclaw >/dev/null 2>&1; then
  ensure_openclaw_home
  exec openclaw "$@"
fi

cat >&2 <<'EOF'
OpenClaw CLI is not available in project-local mode.

What to do:
1) Preferred: install OpenClaw locally so ./node_modules/.bin/openclaw exists.
2) Or point to a binary explicitly:
   OPENCLAW_BIN=/absolute/path/to/openclaw make openclaw-version
3) Optional fallback to a global install:
   OPENCLAW_ALLOW_GLOBAL=1 make openclaw-version
EOF

exit 1
