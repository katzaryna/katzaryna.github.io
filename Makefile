PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
NPM ?= npm
JEKYLL ?= bundle exec jekyll

.DEFAULT_GOAL := help
.PHONY: help setup builder lint lint-python lint-javascript lint-css lint-html lint-yaml lint-markdown lint-toml lint-images test check build build-full

help:
	@printf '%s\n' \
		'Portfolio project commands:' \
		'  make setup            Install build, lint, and test dependencies' \
		'  make builder          Open the local site builder at http://127.0.0.1:8765' \
		'  make lint             Run all configured linters' \
		'  make test             Run pytest, check project covers and fonts' \
		'  make check            Run all linters and tests' \
		'  make build-fast       Run a basic Jekyll build' \
		'  make build            Generate image variants, build, and validate the site'

setup:
	$(PYTHON) -m pip install -r requirements-images.txt -r requirements-dev.txt
	$(NPM) ci --no-audit --no-fund
	bundle install

builder:
	$(PYTHON) -m scripts.site_builder

lint: lint-python lint-javascript lint-css lint-html lint-yaml lint-markdown lint-toml lint-images

lint-python:
	$(PYTHON) -m ruff check scripts tests

lint-javascript:
	$(NPM) exec -- eslint eslint.config.mjs "assets/js/**/*.js" site-builder/app.js

lint-css:
	$(NPM) exec -- stylelint "assets/css/**/*.css" site-builder/styles.css

lint-html:
	$(PYTHON) -m djlint index.html _includes _layouts site-builder/index.html --lint

lint-yaml:
	$(PYTHON) -m yamllint .github _config.yml

lint-markdown:
	$(PYTHON) -m pymarkdown scan README.md projects

lint-toml:
	$(PYTHON) -c 'from toml_sort.cli import cli; cli()' --check config/image_optimization.toml

lint-images:
	$(PYTHON) -m scripts.lint_images

test:
	$(PYTHON) -m pytest tests
	$(PYTHON) -m scripts.check_project_covers
	$(PYTHON) -m scripts.fonts check

check: lint test

build-fast:
	$(JEKYLL) build

build: test
	$(PYTHON) -m scripts.generate_image_variants
	$(JEKYLL) build
	$(PYTHON) -m scripts.prune_unused_assets --site-dir _site
	$(PYTHON) -m scripts.embed_image_metadata --site-dir _site
	$(PYTHON) scripts/validate_site.py --site-dir _site
