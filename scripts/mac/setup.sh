#!/bin/bash
# One-time setup of the site editor on a Mac. Safe to run again.
#
# In Terminal:
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/katzaryna/katzaryna.github.io/main/scripts/mac/setup.sh)"
#
# It installs Homebrew, git, the GitHub CLI, Python and Ruby; saves a GitHub
# access token in the macOS keychain; downloads the site to ~/katzaryna-site;
# installs its dependencies; and puts a "Мой сайт" app in the Dock. The Mac
# user must be an administrator.
#
# The token is a fine-grained personal access token limited to this repository
# with Contents: Read and write and Actions: Read (see README). It can be
# replaced later in the builder: Публикация → Доступ к GitHub.
#
# Optional: GIT_NAME / GIT_EMAIL sign her publications (default: the artist's
# full name from _config.yml and a placeholder address).
set -euo pipefail

REPO_SLUG="katzaryna/katzaryna.github.io"
SITE_DIR="${SITE_DIR:-$HOME/katzaryna-site}"
APP_NAME="${APP_NAME:-Мой сайт}"

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || fail "Этот скрипт для macOS."

step "1/7  Homebrew (менеджер программ)"
if [ -x /opt/homebrew/bin/brew ]; then
  BREW=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW=/usr/local/bin/brew
else
  echo "Сейчас попросят пароль от этого Mac (символы при вводе не видны — это нормально)."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  BREW="$( [ -x /opt/homebrew/bin/brew ] && echo /opt/homebrew/bin/brew || echo /usr/local/bin/brew )"
fi
eval "$("$BREW" shellenv)"
BREW_PREFIX="$(brew --prefix)"

step "2/7  git, GitHub CLI, Python, Ruby"
brew install --quiet git gh python@3.12 ruby
export PATH="$BREW_PREFIX/opt/ruby/bin:$BREW_PREFIX/bin:$PATH"
PYTHON="$BREW_PREFIX/opt/python@3.12/bin/python3.12"

step "3/7  Ключ доступа к GitHub"
if gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Ключ уже сохранён на этом компьютере."
else
  token=""
  while [ -z "$token" ]; do
    read -r -s -p "Вставьте ключ (github_pat_…) и нажмите Enter — символы не видны: " token </dev/tty
    echo
  done
  printf '%s' "$token" | gh auth login --hostname github.com --with-token \
    || fail "GitHub не принял ключ. Проверьте, что он скопирован целиком и не истёк."
  unset token
fi
gh auth setup-git --hostname github.com

step "4/7  Скачиваю сайт в $SITE_DIR"
if [ -d "$SITE_DIR/.git" ]; then
  git -C "$SITE_DIR" pull --ff-only --quiet || echo "Не удалось обновить — продолжаю с текущей версией."
else
  gh repo clone "$REPO_SLUG" "$SITE_DIR" -- --quiet
fi
cd "$SITE_DIR"
if ! git push --dry-run --quiet origin HEAD:refs/heads/main >/dev/null 2>&1; then
  fail "С этим ключом нельзя изменять сайт. Нужен ключ для $REPO_SLUG с разрешением Contents: Read and write. Удалите старый (gh auth logout) и запустите скрипт снова."
fi
default_name="$(sed -n 's/^  full_name: *//p' _config.yml | head -1 | tr -d '"')"
git config user.name "${GIT_NAME:-${default_name:-Katzaryna}}"
git config user.email "${GIT_EMAIL:-site-builder@katzaryna.github.io}"
git config pull.ff only

ruby_wanted="$(cat .ruby-version)"
ruby_have="$(ruby -e 'print RUBY_VERSION')"
case "$ruby_have" in
  "$ruby_wanted"*) ;;
  *) echo "Внимание: нужен Ruby $ruby_wanted, установлен $ruby_have. Предпросмотр может не собраться." ;;
esac

step "5/7  Python-зависимости"
[ -x .venv/bin/python ] || "$PYTHON" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements-images.txt

step "6/7  Jekyll (для предпросмотра)"
bundle config set --local path vendor/bundle
bundle config set --local frozen true
bundle install --quiet
mkdir -p .builder-cache
cat requirements-images.txt Gemfile.lock | shasum | cut -d' ' -f1 >.builder-cache/deps-hash

step "7/7  Приложение «${APP_NAME}» в Dock"
chmod +x scripts/mac/launch.sh
app="$(.venv/bin/python scripts/mac/make_app.py --site "$SITE_DIR" --name "$APP_NAME")"

printf '\n\033[1;32m✔ Готово.\033[0m Редактор открывается иконкой «%s» в Dock (или в папке «Программы» вашей учётной записи).\n' "$APP_NAME"
open "$app"
