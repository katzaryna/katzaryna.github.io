PYTHON ?= python3
NPM ?= npm

.DEFAULT_GOAL := help
.PHONY: help setup lint lint-python lint-javascript lint-css lint-html lint-yaml lint-markdown lint-toml lint-images test check build build-full

help:
	@printf '%s\n' \
		'Portfolio project commands:' \
		'  make setup            Install build, lint, and test dependencies' \
		'  make lint             Run all configured linters' \
		'  make test             Run pytest and check project covers' \
		'  make check            Run all linters and tests' \
		'  make build-fast       Run a basic Jekyll build' \
		'  make build            Generate image variants, build, and validate the site'

setup:
	$(PYTHON) -m pip install -r requirements-images.txt -r requirements-dev.txt
	$(NPM) ci --no-audit --no-fund

lint: lint-python lint-javascript lint-css lint-html lint-yaml lint-markdown lint-toml lint-images

lint-python:
	$(PYTHON) -m ruff check scripts tests

lint-javascript:
	$(NPM) exec -- eslint eslint.config.mjs "assets/js/**/*.js"

lint-css:
	$(NPM) exec -- stylelint "assets/css/**/*.css"

lint-html:
	$(PYTHON) -m djlint index.html _includes _layouts --lint

lint-yaml:
	$(PYTHON) -m yamllint .github/workflows _config.yml

lint-markdown:
	$(PYTHON) -m pymarkdown scan README.md projects

lint-toml:
	$(PYTHON) -c 'from toml_sort.cli import cli; cli()' --check config/image_optimization.toml

lint-images:
	$(PYTHON) -m scripts.lint_images

test:
	$(PYTHON) -m pytest tests
	$(PYTHON) -m scripts.check_project_covers

check: lint test

build-fast:
	jekyll build

build: test
	$(PYTHON) scripts/generate_image_variants.py
	jekyll build
	$(PYTHON) scripts/validate_site.py --site-dir _site
