#!/bin/bash

python3 -m pip install -r requirements-images.txt
python3 scripts/generate_image_variants.py
jekyll build
python3 scripts/validate_site.py --site-dir _site
