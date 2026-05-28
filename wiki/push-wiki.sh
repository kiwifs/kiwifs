#!/bin/bash
# Push wiki content to GitHub wiki repo.
# Usage: After creating the first wiki page on GitHub, run:
#   cd wiki && bash push-wiki.sh

set -euo pipefail

REPO="kiwifs/kiwifs"
WIKI_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR=$(mktemp -d)

echo "Cloning wiki repo..."
TOKEN=$(gh auth token)
git clone "https://x-access-token:${TOKEN}@github.com/${REPO}.wiki.git" "$TMP_DIR"

echo "Copying wiki pages..."
cp "$WIKI_DIR"/*.md "$TMP_DIR/"

cd "$TMP_DIR"
git add -A
if git diff --cached --quiet; then
  echo "No changes to push."
else
  git commit -m "docs: sync wiki from repo wiki/ directory"
  git push origin master || git push origin main
  echo "Wiki pushed successfully!"
fi

rm -rf "$TMP_DIR"
echo "Done. View at: https://github.com/${REPO}/wiki"
