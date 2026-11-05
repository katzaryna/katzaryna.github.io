#!/usr/bin/env python3
"""Publishing for the site builder: git and GitHub in plain words.

The builder's owner never runs git. This module turns the few things she needs
into single calls: what is not published yet, publish it, take a publication
back, bring in changes made elsewhere, and how the deployment on GitHub went.

Only site content is ever committed (see CONTENT_PATHS), so tool or dependency
files changed on her computer cannot reach the live site by accident.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
from typing import Callable
import platform
import re
import shutil
import subprocess
import sys
import threading
import time

import yaml


ROOT = Path(__file__).resolve().parent.parent
BRANCH = "main"
REMOTE = "origin"
WORKFLOW = "jekyll-gh-pages.yml"
CONTENT_PATHS = ("_config.yml", "projects", "assets/images", "redirects")
IMAGE_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".webp"}
GIT_TIMEOUT = 120
FETCH_TIMEOUT = 30
GH_TIMEOUT = 20
HELP_BRANCH_PREFIX = "help/"
RUNNING_STATES = {"queued", "in_progress", "waiting", "requested", "pending"}
TOKEN_PATTERN = re.compile(r"(github_pat_|ghp_)[A-Za-z0-9_]{20,255}")
TOKEN_WARN_DAYS = 14
TOKEN_CHECK_SECONDS = 3600
TOKEN_EXPIRATION_HEADER = re.compile(r"^github-authentication-token-expiration:\s*(.+?)\s*$", re.I | re.M)
AUTH_FAILURES = ("authentication", "permission", "could not read username", "403", "denied", "invalid credentials")
TOKEN_HINT = (
    "Ключ доступа к GitHub не подошёл или истёк. Вставьте новый ключ "
    "на вкладке «Публикация» в разделе «Доступ к GitHub»."
)


class PublishError(Exception):
    """A failure explained in words the site owner understands."""

    status = 409


class GitCommandError(Exception):
    def __init__(self, command: list[str], output: str) -> None:
        super().__init__(f"git {' '.join(command)} failed:\n{output.strip()}")
        self.output = output


def plural(count: int, one: str, few: str, many: str) -> str:
    remainder_100 = count % 100
    remainder_10 = count % 10
    if remainder_10 == 1 and remainder_100 != 11:
        word = one
    elif 2 <= remainder_10 <= 4 and not 12 <= remainder_100 <= 14:
        word = few
    else:
        word = many
    return f"{count} {word}"


def project_title(text: str | None, fallback: str) -> str:
    if not text or not text.startswith("---"):
        return fallback
    try:
        _, front_matter, _ = text.split("---", 2)
        metadata = yaml.safe_load(front_matter) or {}
    except (ValueError, yaml.YAMLError):
        return fallback
    title = metadata.get("title") if isinstance(metadata, dict) else None
    return (str(title).strip() if title else "") or fallback


def parse_token_check(returncode: int, output: str, now: datetime | None = None) -> dict:
    """Read `gh api --include` output: is the saved token valid, and until when."""
    lowered = output.lower()
    if "gh auth login" in lowered or "not logged" in lowered:
        return {"state": "missing"}
    if "http 401" in lowered or "bad credentials" in lowered:
        return {"state": "invalid"}
    if returncode:
        return {"state": "unknown"}
    match = TOKEN_EXPIRATION_HEADER.search(output)
    if not match:
        return {"state": "ok", "expires": None}
    expires = None
    for pattern in ("%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d %H:%M:%S %z"):
        try:
            expires = datetime.strptime(match.group(1), pattern)
            break
        except ValueError:
            continue
    if expires is None:
        return {"state": "ok", "expires": None}
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    days = (expires - (now or datetime.now(timezone.utc))).total_seconds() / 86400
    state = "invalid" if days <= 0 else "expiring" if days < TOKEN_WARN_DAYS else "ok"
    return {"state": state, "expires": expires.isoformat(), "days_left": max(0, int(days))}


@dataclass
class Publisher:
    root: Path = ROOT
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    last_error: str = ""
    last_detail: str = ""
    # Checks site content before it is committed; returns problems in plain words.
    checker: Callable[[list[str]], list[str]] | None = field(default=None, repr=False)
    last_fetch_ok: bool | None = None
    _token_cache: tuple[float, dict] | None = field(default=None, repr=False)

    # ------------------------------------------------------------------
    # Low-level helpers
    # ------------------------------------------------------------------
    def _environment(self) -> dict[str, str]:
        environment = dict(os.environ)
        # Never wait for a password prompt nobody will see.
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GCM_INTERACTIVE"] = "never"
        environment["GH_PROMPT_DISABLED"] = "1"
        environment["GH_NO_UPDATE_NOTIFIER"] = "1"
        environment.setdefault("LC_ALL", "en_US.UTF-8")
        return environment

    def git(self, *args: str, check: bool = True, timeout: int = GIT_TIMEOUT) -> str:
        command = ["git", "-c", "core.quotepath=false", *args]
        try:
            result = subprocess.run(
                command,
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=self._environment(),
                check=False,
            )
        except FileNotFoundError as error:
            raise PublishError("На компьютере не найден git. Запустите установку заново.") from error
        except subprocess.TimeoutExpired as error:
            raise GitCommandError(list(args), "timed out") from error
        if check and result.returncode:
            raise GitCommandError(list(args), result.stdout + result.stderr)
        return result.stdout

    def gh_json(self, *args: str) -> object | None:
        """Run the GitHub CLI and parse its JSON, or None when it is unavailable."""
        if not shutil.which("gh"):
            return None
        try:
            result = subprocess.run(
                ["gh", *args],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=GH_TIMEOUT,
                env=self._environment(),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if result.returncode:
            return None
        try:
            return json.loads(result.stdout or "null")
        except json.JSONDecodeError:
            return None

    def _ref_exists(self, ref: str) -> bool:
        return bool(self.git("rev-parse", "--verify", "--quiet", ref, check=False).strip())

    @property
    def upstream(self) -> str:
        return f"{REMOTE}/{BRANCH}"

    def _base(self) -> str:
        """The last commit shared with GitHub: what is published is compared against it."""
        if self._ref_exists(self.upstream):
            base = self.git("merge-base", "HEAD", self.upstream, check=False).strip()
            if base:
                return base
        return "HEAD"

    def _counts(self) -> tuple[int, int]:
        if not self._ref_exists(self.upstream):
            return 0, 0
        output = self.git("rev-list", "--left-right", "--count", f"HEAD...{self.upstream}").split()
        return int(output[0]), int(output[1])

    def _git_directory(self) -> Path:
        return (self.root / self.git("rev-parse", "--git-dir").strip()).resolve()

    def _operation_in_progress(self) -> bool:
        git_directory = self._git_directory()
        return any(
            (git_directory / name).exists()
            for name in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD")
        )

    def _existing_content_paths(self) -> list[str]:
        """Content paths git can match; `git add` and `git stash` reject the others."""
        tracked = self.git("ls-files", "-z", "--", *CONTENT_PATHS)
        tracked_roots = {root for root in CONTENT_PATHS for path in tracked.split("\0")
                         if path == root or path.startswith(f"{root}/")}
        return [root for root in CONTENT_PATHS if (self.root / root).exists() or root in tracked_roots]

    def _current_branch(self) -> str:
        return self.git("rev-parse", "--abbrev-ref", "HEAD").strip()

    def _show(self, ref: str, path: str) -> str | None:
        output = subprocess.run(
            ["git", "show", f"{ref}:{path}"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self._environment(),
            check=False,
        )
        return output.stdout if output.returncode == 0 else None

    def _read_worktree(self, path: str) -> str | None:
        file = self.root / path
        try:
            return file.read_text(encoding="utf-8") if file.is_file() else None
        except (OSError, UnicodeDecodeError):
            return None

    # ------------------------------------------------------------------
    # What is not published yet
    # ------------------------------------------------------------------
    def changed_files(self) -> dict[str, str]:
        """Content paths that differ from GitHub: {path: 'A' | 'M' | 'D'}."""
        base = self._base()
        changes: dict[str, str] = {}
        diff = self.git("diff", "--name-status", "--no-renames", "-z", base, "--", *CONTENT_PATHS)
        parts = [part for part in diff.split("\0") if part]
        for status, path in zip(parts[0::2], parts[1::2]):
            changes[path] = status[0] if status[0] in "AD" else "M"
        untracked = self.git("ls-files", "--others", "--exclude-standard", "-z", "--", *CONTENT_PATHS)
        for path in filter(None, untracked.split("\0")):
            changes[path] = "A"
        return changes

    def has_uncommitted_content(self) -> bool:
        output = self.git("status", "--porcelain", "--untracked-files=all", "--", *CONTENT_PATHS)
        return bool(output.strip())

    def describe_changes(self, changes: dict[str, str] | None = None) -> list[str]:
        """Turn changed paths into short Russian sentences."""
        changes = self.changed_files() if changes is None else changes
        base = self._base()
        lines: list[str] = []
        projects: dict[str, dict] = {}
        site_images = 0
        other = 0
        for path, status in sorted(changes.items()):
            parts = PurePosixPath(path).parts
            if path == "_config.yml":
                lines.extend(self._describe_config(base))
            elif parts[0] == "projects" and len(parts) == 3:
                entry = projects.setdefault(parts[1], {"index": "", "A": 0, "M": 0, "D": 0})
                if parts[2] == "index.md":
                    entry["index"] = status
                elif PurePosixPath(path).suffix.lower() in IMAGE_SUFFIXES:
                    entry[status] += 1
            elif path.startswith("assets/images/"):
                site_images += 1
            else:
                other += 1

        for slug, entry in projects.items():
            index_path = f"projects/{slug}/index.md"
            title = project_title(self._read_worktree(index_path) or self._show(base, index_path), slug)
            images = [
                f"{verb} {plural(entry[status], 'изображение', 'изображения', 'изображений')}"
                for status, verb in (("A", "добавлено"), ("M", "заменено"), ("D", "удалено"))
                if entry[status]
            ]
            if entry["index"] == "A":
                lines.append(f"Новый проект «{title}»")
            elif entry["index"] == "D":
                lines.append(f"Удалён проект «{title}»")
            else:
                details = (["описание и картинки"] if entry["index"] == "M" else []) + images
                lines.append(f"Проект «{title}»: {', '.join(details)}")
        if site_images:
            lines.append("Портрет или другие картинки сайта")
        if other:
            lines.append(f"Технические файлы: {other}")
        return lines

    def _describe_config(self, base: str) -> list[str]:
        try:
            before = yaml.safe_load(self._show(base, "_config.yml") or "{}") or {}
            after = yaml.safe_load(self._read_worktree("_config.yml") or "{}") or {}
        except yaml.YAMLError:
            return ["Настройки сайта"]
        lines = []
        before_home = before.pop("home_gallery", None)
        after_home = after.pop("home_gallery", None)
        if before_home != after_home:
            lines.append("Главная страница: обложки и их расположение")
        if before != after:
            lines.append("Настройки: текст «Обо мне», контакты и другое")
        return lines

    # ------------------------------------------------------------------
    # GitHub
    # ------------------------------------------------------------------
    def fetch(self) -> bool:
        try:
            self.git("fetch", "--quiet", "--prune", REMOTE, BRANCH, timeout=FETCH_TIMEOUT)
        except GitCommandError:
            self.last_fetch_ok = False
            return False
        self.last_fetch_ok = True
        return True

    def deployment(self) -> dict:
        """How GitHub Actions is doing with the latest published commit."""
        if not self._ref_exists(self.upstream):
            return {"state": "unknown"}
        published = self.git("rev-parse", self.upstream).strip()
        runs = self.gh_json(
            "run", "list",
            "--workflow", WORKFLOW,
            "--branch", BRANCH,
            "--event", "push",
            "--limit", "10",
            "--json", "databaseId,headSha,status,conclusion,url,createdAt",
        )
        if runs is None:
            return {"state": "unknown"}
        run = next((item for item in runs if item.get("headSha") == published), None)
        if run is None:
            # GitHub needs a few seconds to register a fresh push.
            return {"state": "pending", "sha": published}
        if run.get("status") in RUNNING_STATES:
            state = "deploying"
        elif run.get("conclusion") == "success":
            state = "live"
        else:
            state = "failed"
        return {
            "state": state,
            "sha": published,
            "url": run.get("url", ""),
            "started": run.get("createdAt", ""),
            "run_id": run.get("databaseId"),
        }

    def site_url(self) -> str:
        try:
            config = yaml.safe_load((self.root / "_config.yml").read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            return ""
        return f"{config.get('url', '')}{config.get('baseurl', '') or ''}/"

    # ------------------------------------------------------------------
    # Public operations
    # ------------------------------------------------------------------
    def status(self, fetch: bool = False, deployment: bool = True) -> dict:
        with self.lock:
            if fetch:
                self.fetch()
            ahead, behind = self._counts()
            changes = self.changed_files()
            return {
                "branch": self._current_branch(),
                "changes": self.describe_changes(changes),
                "change_count": len(changes),
                "ahead": ahead,
                "behind": behind,
                "online": self.last_fetch_ok,
                "busy": self._operation_in_progress(),
                "deployment": self.deployment() if deployment else {"state": "unknown"},
                "site_url": self.site_url(),
                "last_error": self.last_error,
                "token": self.token_state(),
            }

    # ------------------------------------------------------------------
    # Access token
    # ------------------------------------------------------------------
    def _gh(self, *args: str, input_text: str | None = None) -> subprocess.CompletedProcess | None:
        if not shutil.which("gh"):
            return None
        try:
            return subprocess.run(
                ["gh", *args],
                cwd=self.root,
                input=input_text,
                capture_output=True,
                text=True,
                timeout=GH_TIMEOUT,
                env=self._environment(),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None

    def token_state(self, refresh: bool = False) -> dict:
        """Whether the saved GitHub key works, checked at most once an hour."""
        if self._token_cache and not refresh and time.monotonic() - self._token_cache[0] < TOKEN_CHECK_SECONDS:
            return self._token_cache[1]
        result = self._gh("api", "--include", "repos/{owner}/{repo}")
        state = {"state": "unknown"} if result is None else parse_token_check(
            result.returncode, result.stdout + result.stderr
        )
        if state["state"] != "unknown":
            self._token_cache = (time.monotonic(), state)
        return state

    def set_token(self, token: str) -> dict:
        """Save a new GitHub key for this computer and check that it can publish."""
        token = token.strip()
        if not TOKEN_PATTERN.fullmatch(token):
            raise PublishError("Это не похоже на ключ GitHub: он начинается с github_pat_ и вставляется целиком.")
        with self.lock:
            login = self._gh("auth", "login", "--hostname", "github.com", "--with-token", input_text=token)
            if login is None:
                raise PublishError("На компьютере не найдена программа gh. Запустите установку заново.")
            if login.returncode:
                raise PublishError(f"GitHub не принял ключ. {login.stderr.strip()[:300]}")
            self._gh("auth", "setup-git", "--hostname", "github.com")
            self._token_cache = None
            # A dry-run push asks GitHub for write access without changing anything.
            probe = subprocess.run(
                ["git", "push", "--dry-run", "--porcelain", REMOTE, f"HEAD:refs/heads/{BRANCH}"],
                cwd=self.root, capture_output=True, text=True, timeout=FETCH_TIMEOUT,
                env=self._environment(), check=False,
            )
            if probe.returncode and any(word in (probe.stderr + probe.stdout).lower() for word in AUTH_FAILURES):
                raise PublishError(
                    "Ключ сохранён, но с ним нельзя изменять сайт. Нужен ключ для этого репозитория "
                    "с разрешением Contents: Read and write."
                )
            self.last_error = ""
            return self.status()

    def sync(self) -> dict:
        """Bring in changes published from another computer, when that is safe."""
        with self.lock:
            if not self.fetch():
                return {"result": "offline"}
            ahead, behind = self._counts()
            if not behind:
                return {"result": "up-to-date"}
            if ahead or self._operation_in_progress() or self._current_branch() != BRANCH:
                return {"result": "later"}
            before = self.git("rev-parse", "HEAD").strip()
            try:
                self.git("merge", "--ff-only", "--quiet", self.upstream)
            except GitCommandError:
                # Local edits touch the same files; publishing will combine them.
                return {"result": "later"}
            changed = self.git("diff", "--name-only", before, "HEAD").split()
            code_changed = any(
                not any(path == root or path.startswith(f"{root}/") for root in CONTENT_PATHS)
                for path in changed
            )
            return {"result": "updated", "code_changed": code_changed}

    def publish(self, message: str = "") -> dict:
        """Commit every content change, put it on GitHub and return the new status."""
        with self.lock:
            try:
                result = self._publish(message.strip())
                self.last_error = self.last_detail = ""
                return result
            except PublishError as error:
                self.last_error = str(error)
                self.last_detail = str(error.__cause__ or "")
                raise
            except GitCommandError as error:
                self.last_error = (
                    "Не получилось опубликовать. Ваши правки сохранены на этом компьютере. "
                    "Скопируйте отчёт внизу и отправьте его тому, кто помогает с сайтом."
                )
                self.last_detail = str(error)
                raise PublishError(self.last_error) from error

    def _check_ready(self) -> None:
        if self._operation_in_progress():
            raise PublishError("Сайт в промежуточном состоянии после прошлой ошибки. Нужна помощь.")
        if self._current_branch() != BRANCH:
            raise PublishError(f"Открыта не основная версия сайта ({self._current_branch()}). Нужна помощь.")

    def _identity(self) -> list[str]:
        if self.git("config", "user.email", check=False).strip():
            return []
        return ["-c", "user.name=Site builder", "-c", "user.email=builder@localhost"]

    def _publish(self, message: str) -> dict:
        self._check_ready()
        if self.has_uncommitted_content():
            problems = self.checker(sorted(self.changed_files())) if self.checker else []
            if problems:
                raise PublishError("Перед публикацией нужно поправить:\n" + "\n".join(f"• {item}" for item in problems))
            summary = self.describe_changes()
            subject = message or (summary[0] if summary else "Обновление сайта")
            body = "\n".join(f"- {line}" for line in summary)
            self.git("add", "--all", "--", *self._existing_content_paths())
            self.git(*self._identity(), "commit", "--quiet", "-m", subject[:200], "-m", body or "Обновление сайта")
        if not self.fetch():
            raise PublishError(
                "Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз — правки никуда не денутся."
            )
        ahead, behind = self._counts()
        if not ahead:
            raise PublishError("Публиковать нечего: всё уже на сайте.")
        if behind:
            self._combine_with_github()
        self._push()
        return self.status(deployment=False)

    def _combine_with_github(self) -> None:
        """Put local publications on top of changes made from another computer."""
        try:
            self.git("rebase", "--autostash", "--quiet", self.upstream)
        except GitCommandError as error:
            self.git("rebase", "--abort", check=False)
            branch = f"{HELP_BRANCH_PREFIX}{time.strftime('%Y-%m-%d-%H%M')}"
            self.git("push", "--quiet", REMOTE, f"HEAD:refs/heads/{branch}", check=False, timeout=FETCH_TIMEOUT)
            raise PublishError(
                "Ваши правки пересеклись с изменениями, сделанными на другом компьютере, "
                f"и их нужно соединить вручную. Всё сохранено (копия на GitHub: {branch}). "
                "Нажмите «Позвать на помощь»."
            ) from error

    def _push(self) -> None:
        for attempt in range(2):
            try:
                self.git("push", "--quiet", REMOTE, f"HEAD:{BRANCH}", timeout=GIT_TIMEOUT)
                return
            except GitCommandError as error:
                text = error.output.lower()
                rejected = "rejected" in text or "fetch first" in text or "non-fast-forward" in text
                if attempt == 0 and rejected and self.fetch():
                    self._combine_with_github()
                    continue
                if any(word in text for word in AUTH_FAILURES):
                    self._token_cache = None
                    raise PublishError(TOKEN_HINT) from error
                raise

    def history(self, limit: int = 40) -> list[dict]:
        """Recent publications; only those that changed nothing but content can be undone here."""
        with self.lock:
            unit, record = "\x1f", "\x1e"
            output = self.git(
                "log", f"-{limit}", "--first-parent", "--name-only",
                f"--format={record}%H{unit}%an{unit}%ae{unit}%aI{unit}%s{unit}%P",
                "HEAD",
            )
            published = set()
            if self._ref_exists(self.upstream):
                published = set(self.git("rev-list", f"-{limit * 2}", self.upstream).split())
            my_email = self.git("config", "user.email", check=False).strip().lower()
            entries = []
            for chunk in filter(None, output.split(record)):
                header, _, names = chunk.partition("\n")
                sha, author, email, date, subject, parents = header.split(unit)
                files = [name for name in names.splitlines() if name]
                technical = any(
                    not any(path == root or path.startswith(f"{root}/") for root in CONTENT_PATHS)
                    for path in files
                )
                entries.append({
                    "sha": sha,
                    "author": author,
                    "mine": bool(my_email) and email.lower() == my_email,
                    "date": date,
                    "subject": subject,
                    "published": sha in published,
                    "technical": technical or len(parents.split()) != 1,
                    "can_undo": bool(files) and not technical and len(parents.split()) == 1 and sha in published,
                })
            return entries

    def undo(self, sha: str) -> dict:
        """Publish a new version that takes back one earlier publication."""
        with self.lock:
            self._check_ready()
            if self.has_uncommitted_content():
                raise PublishError("Сначала опубликуйте или отмените текущие неопубликованные правки.")
            entry = next((item for item in self.history(200) if item["sha"] == sha), None)
            if entry is None or not entry["can_undo"]:
                raise PublishError("Эту публикацию нельзя отменить отсюда.")
            try:
                self.git("revert", "--no-commit", sha)
            except GitCommandError as error:
                self.git("revert", "--abort", check=False)
                self.git("reset", "--hard", "--quiet", "HEAD", check=False)
                raise PublishError(
                    "Эту публикацию нельзя отменить автоматически: после неё те же места уже менялись."
                ) from error
            self.git(*self._identity(), "commit", "--quiet", "-m", f"Отмена: {entry['subject']}"[:200])
            return self.publish()

    def discard(self) -> dict:
        """Drop unpublished edits, keeping a stash so they can still be recovered."""
        with self.lock:
            if not self.has_uncommitted_content():
                return self.status(deployment=False)
            label = f"Конструктор: отменённые правки {time.strftime('%Y-%m-%d %H:%M')}"
            self.git("stash", "push", "--include-untracked", "--quiet", "-m", label, "--", *self._existing_content_paths())
            return self.status(deployment=False)

    def help_report(self) -> str:
        with self.lock:
            sections = {
                "Дата": time.strftime("%Y-%m-%d %H:%M:%S %z"),
                "Компьютер": f"macOS {platform.mac_ver()[0] or platform.platform()}, Python {sys.version.split()[0]}",
                "Папка": str(self.root),
                "git status": self.git("status", "--branch", "--short", check=False),
                "Последние коммиты": self.git("log", "-8", "--oneline", "--decorate", "--all", check=False),
                "Сохранённые копии (stash)": self.git("stash", "list", check=False) or "—",
                "Последняя ошибка": "\n".join(filter(None, (self.last_error, self.last_detail))) or "—",
            }
            try:
                deployment = self.deployment()
            except (GitCommandError, PublishError) as error:
                deployment = {"error": str(error)}
            sections["Публикация на GitHub"] = json.dumps(deployment, ensure_ascii=False)
            if deployment.get("state") == "failed" and deployment.get("run_id"):
                log = subprocess.run(
                    ["gh", "run", "view", str(deployment["run_id"]), "--log-failed"],
                    cwd=self.root, capture_output=True, text=True, timeout=GH_TIMEOUT, check=False,
                    env=self._environment(),
                )
                sections["Ошибка сборки (хвост)"] = (log.stdout or log.stderr)[-4000:]
            log_file = self.root / ".builder-cache" / "builder.log"
            if log_file.is_file():
                sections["Журнал конструктора (хвост)"] = log_file.read_text(errors="replace")[-3000:]
            return "\n\n".join(f"## {title}\n{body.strip()}" for title, body in sections.items())


def main() -> None:
    parser = argparse.ArgumentParser(description="Publishing helpers for the site builder.")
    parser.add_argument("command", choices=("status", "sync", "report"))
    command = parser.parse_args().command
    publisher = Publisher()
    if command == "sync":
        print(json.dumps(publisher.sync(), ensure_ascii=False))
    elif command == "status":
        print(json.dumps(publisher.status(fetch=True), ensure_ascii=False, indent=2))
    else:
        print(publisher.help_report())


if __name__ == "__main__":
    main()
