import json
from graphify.detect import detect
from pathlib import Path

result = detect(Path('.'))
Path('graphify-out/.graphify_detect.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Detected {result.get('total_files', 0)} files")

