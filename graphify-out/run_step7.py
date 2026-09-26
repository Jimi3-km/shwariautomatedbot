import json
from pathlib import Path
from datetime import datetime, timezone
from graphify.manifest import save_manifest
from graphify.cli import _stamped_manifest_files

extract = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding="utf-8"))
detect  = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding="utf-8"))

_corpus = detect.get('all_files') or detect['files']
_manifest_files = _stamped_manifest_files(_corpus, extract, Path('.'))
_sem_types = ('document', 'paper', 'image')
_dispatched = {f for t, fl in detect['files'].items() if t in _sem_types for f in fl}
_stamped = {f for fl in _manifest_files.values() for f in fl}
_cleared = _dispatched - _stamped
_scan = {f for fl in _corpus.values() for f in fl}
save_manifest(_manifest_files, root='.', scan_corpus=_scan, clear_semantic=_cleared or None)

cost_path = Path('graphify-out/cost.json')
cost = {'runs': [], 'total_input_tokens': 0, 'total_output_tokens': 0}
cost['runs'].append({
    'date': datetime.now(timezone.utc).isoformat(),
    'input_tokens': 0,
    'output_tokens': 0,
    'files': detect.get('total_files', 0),
})
cost_path.write_text(json.dumps(cost, indent=2, ensure_ascii=False), encoding="utf-8")
print("Manifest and cost tracking saved successfully.")

