#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python_bin="${PYTHON:-python3}"

run_local_fallback() {
  rm -rf .venv .bootstrap-deps
  echo "python venv is unavailable; installing test dependencies into .bootstrap-deps instead."
  "${python_bin}" -m pip install --target .bootstrap-deps ".[dev]"
  PYTHONPATH=".bootstrap-deps:src${PYTHONPATH:+:${PYTHONPATH}}" "${python_bin}" -m pytest
  cat <<'EOF'
Bootstrap complete with local dependency fallback.

Before running the Telegram bot, create .env from .env.example and set SKY_BOT_TOKEN.
EOF
}

if [ ! -f .venv/bin/activate ]; then
  if "${python_bin}" -c "import ensurepip" >/dev/null 2>&1; then
    "${python_bin}" -m venv .venv
  else
    run_local_fallback
    exit 0
  fi
fi

# shellcheck source=/dev/null
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
python -m pytest

cat <<'EOF'
Bootstrap complete.

Before running the Telegram bot, create .env from .env.example and set SKY_BOT_TOKEN.
EOF
