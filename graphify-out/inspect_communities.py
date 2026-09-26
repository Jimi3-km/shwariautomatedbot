import json
from pathlib import Path

analysis = json.loads(Path('graphify-out/.graphify_analysis.json').read_text(encoding="utf-8"))
graph = json.loads(Path('graphify-out/graph.json').read_text(encoding="utf-8"))

node_map = {n['id']: n for n in graph.get('nodes', [])}

print(f"Total communities: {len(analysis['communities'])}")
for cid, nids in sorted(analysis['communities'].items(), key=lambda x: len(x[1]), reverse=True)[:25]:
    sample_nodes = [node_map[nid].get('label', nid) for nid in nids if nid in node_map][:8]
    files = list({node_map[nid].get('source_file', '') for nid in nids if nid in node_map and node_map[nid].get('source_file')})[:3]
    print(f"C{cid} ({len(nids)} nodes): {sample_nodes} | files: {files}")

