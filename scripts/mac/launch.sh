#!/bin/bash
# Opens the site builder: the "Мой сайт" app in the Dock runs this script.
#
# 1. If the builder is already running, just show it.
# 2. Otherwise bring in changes published from other computers, refresh
#    dependencies when their lock files changed, start the builder in the
#    background, and open it in the default browser.
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=8765
URL="http://127.0.0.1:${PORT}/"
CACHE="$REPO/.builder-cache"
LOG="$CACHE/builder.log"

# Apps started from the Dock get a minimal PATH.
for prefix in /opt/homebrew /usr/local; do
  if [ -x "$prefix/bin/brew" ]; then
    export PATH="$prefix/opt/ruby/bin:$prefix/bin:$PATH"
    break
  fi
done

alert() {
  /usr/bin/osascript - "$1" <<'APPLESCRIPT' >/dev/null 2>&1
on run argv
  display dialog (item 1 of argv) with title "Мой сайт" buttons {"OK"} default button 1 with icon caution
end run
APPLESCRIPT
}

running() {
  /usr/bin/curl -fsS -m 2 "${URL}api/status" >/dev/null 2>&1
}

if running; then
  /usr/bin/open "$URL"
  exit 0
fi

cd "$REPO" || exit 1
mkdir -p "$CACHE"
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 2000000 ]; then
  tail -c 500000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
echo "=== $(date) — запуск" >>"$LOG"

if [ ! -x .venv/bin/python ]; then
  alert "Редактор сайта не установлен до конца. Запустите установку ещё раз (scripts/mac/setup.sh)."
  exit 1
fi

# Changes published from another computer arrive before anything is opened.
.venv/bin/python -m scripts.site_publisher sync >>"$LOG" 2>&1 || true

# Reinstall dependencies only when their lock files changed.
deps_hash="$(cat requirements-images.txt Gemfile.lock | /usr/bin/shasum | cut -d' ' -f1)"
if [ "$(cat "$CACHE/deps-hash" 2>/dev/null)" != "$deps_hash" ]; then
  if .venv/bin/python -m pip install --quiet -r requirements-images.txt >>"$LOG" 2>&1 \
    && bundle install --quiet >>"$LOG" 2>&1; then
    echo "$deps_hash" >"$CACHE/deps-hash"
  fi
fi

nohup .venv/bin/python -m scripts.site_builder --port "$PORT" >>"$LOG" 2>&1 &

for _ in $(seq 1 60); do
  if running; then
    /usr/bin/open "$URL"
    exit 0
  fi
  sleep 0.5
done

alert "Редактор сайта не запустился. Перезагрузите компьютер и попробуйте ещё раз. Если не поможет — отправьте файл .builder-cache/builder.log из папки сайта тому, кто помогает с сайтом."
exit 1
