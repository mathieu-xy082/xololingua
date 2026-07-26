#!/usr/bin/env python3
"""Prepare packaged browser model assets for XoloLingua real browser E2E.

The browser workers run Transformers.js with remote downloads disabled:

  env.allowRemoteModels = false
  env.localModelPath = "models/"

This tool copies or symlinks already-downloaded Transformers.js-compatible model
snapshots into the expected local layout, writes small local stage manifests with
bytes/sha256 for every packaged file, and updates frontend/model_asset_manifest.js
so the bootstrap/cache resolver tracks the real files instead of placeholder
checksums.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from hashlib import sha256
from pathlib import Path
from typing import Iterable, NamedTuple


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODELS_ROOT = ROOT / "models"
DEFAULT_APP_MANIFEST = ROOT / "frontend" / "model_asset_manifest.js"


class ModelSpec(NamedTuple):
    stage: str
    asset_prefix: str
    manifest_url: str
    model_id: str
    target_subdir: str
    default_source_env: str
    default_source_candidates: tuple[Path, ...]

    @property
    def label(self) -> str:
        return "ASR" if self.stage == "transcription" else "translation"


SPECS = (
    ModelSpec(
        stage="transcription",
        asset_prefix="asr",
        manifest_url="models/asr/whisper-tiny/manifest.json",
        model_id="Xenova/whisper-tiny",
        target_subdir="Xenova/whisper-tiny",
        default_source_env="XOLOLINGUA_ASR_MODEL_SOURCE",
        default_source_candidates=(
            ROOT / ".models" / "Xenova" / "whisper-tiny",
            Path.home() / ".cache" / "huggingface" / "hub" / "models--Xenova--whisper-tiny",
        ),
    ),
    ModelSpec(
        stage="translation",
        asset_prefix="translation",
        manifest_url="models/translation/opus-mt-fr-en/manifest.json",
        model_id="Xenova/opus-mt-fr-en",
        target_subdir="Xenova/opus-mt-fr-en",
        default_source_env="XOLOLINGUA_TRANSLATION_MODEL_SOURCE",
        default_source_candidates=(
            ROOT / ".models" / "Xenova" / "opus-mt-fr-en",
            Path.home() / ".cache" / "huggingface" / "hub" / "models--Xenova--opus-mt-fr-en",
        ),
    ),
)


class PreparedModel(NamedTuple):
    spec: ModelSpec
    manifest_path: Path
    manifest_entry: dict
    asset_entries: list[dict]


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-root", type=Path, default=DEFAULT_MODELS_ROOT)
    parser.add_argument("--app-manifest", type=Path, default=DEFAULT_APP_MANIFEST)
    parser.add_argument("--asr-source", type=Path, default=None, help="Local Transformers.js snapshot for Xenova/whisper-tiny.")
    parser.add_argument("--translation-source", type=Path, default=None, help="Local Transformers.js snapshot for Xenova/nllb-200-distilled-600M.")
    parser.add_argument("--copy-mode", choices=["copy", "symlink"], default="copy")
    parser.add_argument("--no-update-app-manifest", action="store_true")
    return parser.parse_args(argv)


def prepare_browser_model_assets(
    *,
    models_root: Path = DEFAULT_MODELS_ROOT,
    app_manifest_path: Path = DEFAULT_APP_MANIFEST,
    asr_source: Path | None = None,
    translation_source: Path | None = None,
    copy_mode: str = "copy",
    update_app_manifest: bool = True,
) -> dict:
    models_root = models_root.resolve()
    app_manifest_path = app_manifest_path.resolve()
    sources = {
        "transcription": resolve_source(SPECS[0], asr_source),
        "translation": resolve_source(SPECS[1], translation_source),
    }

    prepared = []
    for spec in SPECS:
        prepared.append(prepare_one_model(spec, sources[spec.stage], models_root, copy_mode))

    if update_app_manifest:
        update_browser_model_asset_manifest(app_manifest_path, prepared)

    return {
        "status": "ready",
        "modelsRoot": str(models_root),
        "appManifest": str(app_manifest_path),
        "models": [
            {
                "stage": item.spec.stage,
                "modelId": item.spec.model_id,
                "manifest": relative_url(item.manifest_path, models_root.parent),
                "assetCount": 1 + len(item.asset_entries),
                "bytes": item.manifest_entry["bytes"] + sum(asset["bytes"] for asset in item.asset_entries),
            }
            for item in prepared
        ],
    }


def resolve_source(spec: ModelSpec, explicit: Path | None) -> Path:
    if explicit is not None:
        source = explicit.expanduser().resolve()
    elif os.environ.get(spec.default_source_env):
        source = Path(os.environ[spec.default_source_env]).expanduser().resolve()
    else:
        source = next((resolve_candidate_source(candidate) for candidate in spec.default_source_candidates if resolve_candidate_source(candidate) is not None), None)
        if source is None:
            candidates = ", ".join(str(path) for path in spec.default_source_candidates)
            raise FileNotFoundError(
                f"{spec.label} source directory not found. Pass --{spec.asset_prefix}-source or set "
                f"{spec.default_source_env}. Checked: {candidates}"
            )
    if not source.is_dir():
        raise FileNotFoundError(f"{spec.label} source directory not found: {source}")
    return source


def resolve_candidate_source(candidate: Path) -> Path | None:
    candidate = candidate.expanduser().resolve()
    if not candidate.is_dir():
        return None
    snapshot = find_latest_snapshot(candidate)
    return snapshot or candidate


def find_latest_snapshot(huggingface_model_dir: Path) -> Path | None:
    snapshots = huggingface_model_dir / "snapshots"
    if not snapshots.is_dir():
        return None
    candidates = [path for path in snapshots.iterdir() if path.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime).resolve()


def prepare_one_model(spec: ModelSpec, source: Path, models_root: Path, copy_mode: str) -> PreparedModel:
    target = models_root / spec.target_subdir
    stage_manifest = models_root / Path(spec.manifest_url).relative_to("models")
    copy_model_tree(source, target, copy_mode)
    asset_entries = build_asset_entries(target, models_root.parent)
    stage_manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest_payload = {
        "stage": spec.stage,
        "modelId": spec.model_id,
        "localModelPath": "models/",
        "assets": asset_entries,
    }
    stage_manifest.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    manifest_entry = create_asset_entry(stage_manifest, models_root.parent, f"{spec.asset_prefix}-manifest")
    return PreparedModel(spec=spec, manifest_path=stage_manifest, manifest_entry=manifest_entry, asset_entries=asset_entries)


def copy_model_tree(source: Path, target: Path, copy_mode: str) -> None:
    if source.resolve() == target.resolve():
        return
    if target.exists() or target.is_symlink():
        if target.is_symlink() or target.is_file():
            target.unlink()
        else:
            shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if copy_mode == "symlink":
        target.symlink_to(source, target_is_directory=True)
        return
    shutil.copytree(source, target, ignore=shutil.ignore_patterns(".git", ".cache", "*.lock"))


def build_asset_entries(model_dir: Path, repo_root: Path) -> list[dict]:
    entries = []
    for path in sorted(model_dir.rglob("*")):
        if not path.is_file():
            continue
        if any(part.startswith(".") for part in path.relative_to(model_dir).parts):
            continue
        entries.append(create_asset_entry(path, repo_root, path.stem))
    if not entries:
        raise ValueError(f"No packaged model files found in {model_dir}")
    return entries


def create_asset_entry(path: Path, repo_root: Path, name: str) -> dict:
    data = path.read_bytes()
    return {
        "name": name,
        "url": relative_url(path, repo_root),
        "bytes": len(data),
        "sha256": sha256(data).hexdigest(),
        "required": True,
    }


def relative_url(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def update_browser_model_asset_manifest(app_manifest_path: Path, prepared: list[PreparedModel]) -> None:
    source = app_manifest_path.read_text(encoding="utf-8")
    updated = source
    for item in prepared:
        entries = [item.manifest_entry, *item.asset_entries]
        block = render_js_asset_block(entries, indent="      ")
        updated = replace_stage_assets(updated, item.spec.stage, block)
    if updated == source:
        raise RuntimeError(f"No asset blocks were updated in {app_manifest_path}")
    app_manifest_path.write_text(updated, encoding="utf-8")


def replace_stage_assets(source: str, stage: str, rendered_assets: str) -> str:
    stage_match = re.search(rf'stage:\s*"{re.escape(stage)}"', source)
    if not stage_match:
        raise RuntimeError(f"Could not find stage {stage!r} in frontend model asset manifest")
    assets_match = re.search(r"assets:\s*Object\.freeze\(\[", source[stage_match.start():])
    if not assets_match:
        raise RuntimeError(f"Could not find assets block for stage {stage!r}")
    start = stage_match.start() + assets_match.end()
    end = find_matching_asset_array_end(source, start)
    return source[:start] + "\n" + rendered_assets + source[end:]


def find_matching_asset_array_end(source: str, start: int) -> int:
    marker = "\n      ]),"
    end = source.find(marker, start)
    if end == -1:
        raise RuntimeError("Could not find end of assets Object.freeze block")
    return end


def render_js_asset_block(entries: list[dict], indent: str) -> str:
    rendered = []
    entry_indent = indent
    field_indent = indent + "  "
    for entry in entries:
        rendered.append(f"{entry_indent}Object.freeze({{")
        rendered.append(f'{field_indent}name: {json.dumps(entry["name"])},')
        rendered.append(f'{field_indent}url: {json.dumps(entry["url"])},')
        rendered.append(f'{field_indent}bytes: {entry["bytes"]},')
        rendered.append(f'{field_indent}sha256: {json.dumps(entry["sha256"])},')
        rendered.append(f'{field_indent}required: true,')
        rendered.append(f"{entry_indent}}}),")
    return "\n".join(rendered).rstrip(",")


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    report = prepare_browser_model_assets(
        models_root=args.models_root,
        app_manifest_path=args.app_manifest,
        asr_source=args.asr_source,
        translation_source=args.translation_source,
        copy_mode=args.copy_mode,
        update_app_manifest=not args.no_update_app_manifest,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"prepare-browser-model-assets failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
