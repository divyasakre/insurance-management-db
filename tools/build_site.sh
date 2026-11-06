#!/usr/bin/env bash
# Rebuilds the GitHub Pages site data from the MySQL source of truth.
#   bash tools/build_site.sh            # copy sql/*.sql into docs/data/mysql
#   python3 tools/gen_seed.py sql/02_seed_data.sql   # (optional) regenerate sample data first
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/data/mysql
cp sql/0*.sql docs/data/mysql/
echo "Copied $(ls sql/0*.sql | wc -l) SQL files into docs/data/mysql/"
