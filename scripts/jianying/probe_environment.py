"""Read-only validation of the sealed serializer environment."""
import hashlib
import json
import sys
from pathlib import Path


def probe():
    if sys.version_info.major != 3 or sys.version_info < (3, 10):
        raise RuntimeError("Jianying serializer requires Python 3.10 or later in the Python 3 series")
    root = Path(__file__).parent
    manifest_file = root / "source-manifest.json"
    manifest_bytes = manifest_file.read_bytes()
    manifest = json.loads(manifest_bytes)
    for relative, digest in manifest["files"].items():
        file = root / "vendor" / "pyJianYingDraft" / relative
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise RuntimeError("Serializer source mismatch: " + relative)
    sys.path.insert(0, str(root / "vendor"))
    import pyJianYingDraft as draft
    if draft.TextIntro.渐显.value.resource_id != "6724916044072227332" or draft.TextOutro.渐隐.value.resource_id != "6724919382104871427":
        raise RuntimeError("Serializer animation metadata mismatch")
    return {"pythonVersion": list(sys.version_info[:3]), "sourceManifestHash": hashlib.sha256(manifest_bytes).hexdigest()}


if __name__ == "__main__":
    print(json.dumps(probe()))
