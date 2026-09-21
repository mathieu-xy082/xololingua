"""Build a public web directory without exposing the source checkout."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "index.html",
    "app.js",
    "styles.css",
    "sw.js",
    "manifest.webmanifest",
)
DIRECTORIES = (
    "assets",
    "frontend",
    "node_modules/@ffmpeg/ffmpeg/dist",
    "node_modules/@ffmpeg/core/dist",
    "node_modules/onnxruntime-web/dist",
    "node_modules/@ricky0123/vad-web/dist",
    "node_modules/@huggingface/transformers/dist",
    "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist",
)


def build(output: Path) -> Path:
    output = output.resolve()
    if output == ROOT or output.exists():
        raise ValueError(f"Output directory must be new and must not be the project root: {output}")
    if any(output.is_relative_to(ROOT / path) for path in DIRECTORIES):
        raise ValueError(f"Output directory must not be inside a copied source directory: {output}")

    missing = [path for path in (*FILES, *DIRECTORIES) if not (ROOT / path).exists()]
    if missing:
        raise FileNotFoundError(f"Missing web dependencies: {', '.join(missing)}. Run npm ci first.")

    output.mkdir(parents=True)
    for path in FILES:
        destination = output / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / path, destination)
    for path in DIRECTORIES:
        destination = output / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(ROOT / path, destination)

    # Every precached file must exist, including those with cache-busting query strings.
    sw = (output / "sw.js").read_text()
    asset_list = sw.split("const ASSETS = [", 1)[1].split("];", 1)[0]
    import re

    precached = re.findall(r'"([^\"]+)"', asset_list)
    missing_assets = [asset for asset in precached if not (output / asset.split("?", 1)[0]).exists() and asset != "."]
    if missing_assets:
        raise FileNotFoundError(f"Missing service-worker assets: {', '.join(missing_assets)}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    print(f"Static site ready: {build(args.output)}")


if __name__ == "__main__":
    main()
