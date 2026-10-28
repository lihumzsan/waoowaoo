"""Import an extracted Wao project into a NEW explicit directory; never overwrite."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def import_project(source, destination):
    source, destination = source.resolve(strict=True), destination.absolute()
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    if (manifest["schemaVersion"] != 1
            or manifest["profileRevision"] != "pyjianyingdraft-32c56928-wao-1"
            or manifest["draftFileName"] not in ("draft_info.json", "draft_content.json")):
        raise ValueError("Unsupported Wao project manifest")
    files = []
    for item in manifest["files"]:
        relative = item["path"]
        parts = relative.split("/")
        if not relative or "\\" in relative or ":" in relative or any(part in ("", ".", "..") for part in parts):
            raise ValueError("Unsafe project path")
        file = (source / relative).resolve(strict=True)
        if not file.is_relative_to(source) or not file.is_file():
            raise ValueError("File escapes source project")
        if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Project file hash mismatch: " + relative)
        files.append((relative, file))
    draft_name = manifest["draftFileName"]
    declared = {relative for relative, _ in files}
    if not {draft_name, "draft_meta_info.json"}.issubset(declared):
        raise ValueError("Missing project files")
    content = json.loads((source / draft_name).read_text(encoding="utf-8"))
    for material in content["materials"]["videos"]:
        relative = material["path"].removeprefix("__WAO_PROJECT__/")
        if material["path"] != "__WAO_PROJECT__/" + relative or relative not in declared or not relative.startswith("media/"):
            raise ValueError("Undeclared media path")
        material["path"] = str(destination / relative)
    metadata = json.loads((source / "draft_meta_info.json").read_text(encoding="utf-8"))
    metadata["draft_fold_path"] = str(destination)
    metadata["draft_root_path"] = str(destination.parent)
    # mkdir is the exclusive creation boundary. Existing user projects are never touched.
    destination.mkdir(parents=False, exist_ok=False)
    try:
        for relative, file in files:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as handle:
                handle.write(file.read_bytes())
        (destination / draft_name).write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
        (destination / "draft_meta_info.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    except BaseException:
        shutil.rmtree(destination)
        raise
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    print(import_project(args.source, args.destination))
