"""Builds the small app-only update beside the full installer.

    python make_update_package.py stage\\app out-folder cctv-setup-7 build_windows.ps1

Writes VERSION and RUNTIME into the app, then dvs-cctv-app.zip and
dvs-cctv-app.json. RUNTIME is a hash of what a package cannot replace: Python
libraries, bundled program versions and models. A PC only takes a package with
the same RUNTIME as its own; otherwise it needs the full installer.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

MODEL_FILES = {".pt", ".pth", ".onnx", ".joblib", ".pkl", ".engine", ".tflite", ".bin"}
NEVER_PACKED = {".env", "config/cameras.yaml"}
BUILD_PINS = re.compile(r"^\$\w+Version = |^\$PythonRelease = |torch==")


def runtime_hash(app: Path, build_script: Path) -> str:
    digest = hashlib.sha256()
    for name in ("requirements.txt", "installer/constraints.txt"):
        digest.update((app / name).read_bytes().replace(b"\r\n", b"\n"))
    for line in build_script.read_text(encoding="utf-8").splitlines():
        if BUILD_PINS.search(line):
            digest.update(line.strip().encode())
    for path in sorted(p for p in app.rglob("*") if p.suffix.lower() in MODEL_FILES):
        digest.update(path.relative_to(app).as_posix().encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def packed_files(app: Path) -> list[Path]:
    keep = []
    for path in sorted(p for p in app.rglob("*") if p.is_file()):
        name = path.relative_to(app).as_posix()
        if path.suffix.lower() not in MODEL_FILES and name not in NEVER_PACKED and "__pycache__" not in name:
            keep.append(path)
    return keep


def build(app: Path, out: Path, version: str, build_script: Path) -> dict:
    runtime = runtime_hash(app, build_script)
    (app / "VERSION").write_text(version + "\n", encoding="utf-8")
    (app / "RUNTIME").write_text(runtime + "\n", encoding="utf-8")
    out.mkdir(parents=True, exist_ok=True)
    package = out / "dvs-cctv-app.zip"
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in packed_files(app):
            archive.write(path, path.relative_to(app).as_posix())
    manifest = {"version": version, "runtime": runtime, "size": package.stat().st_size,
                "sha256": hashlib.sha256(package.read_bytes()).hexdigest()}
    (out / "dvs-cctv-app.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    print(build(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])))
