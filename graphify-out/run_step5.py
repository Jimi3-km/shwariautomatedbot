import json
from graphify.build import build_from_json
from graphify.cluster import score_all
from graphify.analyze import suggest_questions
from graphify.report import generate
from graphify.export import to_json
from pathlib import Path

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding="utf-8"))
detection  = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding="utf-8"))
analysis   = json.loads(Path('graphify-out/.graphify_analysis.json').read_text(encoding="utf-8"))
graph      = json.loads(Path('graphify-out/graph.json').read_text(encoding="utf-8"))

node_map = {n['id']: n for n in graph.get('nodes', [])}

labels = {}
for cid, nids in analysis['communities'].items():
    sample_nodes = [node_map[nid].get('label', nid) for nid in nids if nid in node_map]
    sample_str = " ".join(sample_nodes).lower()
    files = " ".join([node_map[nid].get('source_file', '') for nid in nids if nid in node_map]).lower()
    
    if 'server.ts' in files or 'createapp' in sample_str:
        labels[int(cid)] = "Express Server Entrypoint"
    elif 'roles.ts' in files or 'agent_blueprints' in sample_str:
        labels[int(cid)] = "AI Workforce Roles & Blueprints"
    elif 'agent.ts' in files or 'runagentturn' in sample_str:
        labels[int(cid)] = "Agent Runtime & Execution Loop"
    elif 'llm.ts' in files or 'complete(' in sample_str:
        labels[int(cid)] = "NVIDIA LLM Client"
    elif 'business.ts' in files or 'operations.ts' in files or 'getpaymentinstructions' in sample_str:
        labels[int(cid)] = "AI Tooling & Operations"
    elif 'shwari.tsx' in files or 'getshwari' in sample_str:
        labels[int(cid)] = "Shwari Executive Assistant UI"
    elif 'agents.tsx' in files or 'agentcard' in sample_str:
        labels[int(cid)] = "Agent Management UI"
    elif 'whatsapp' in files or 'whatsapp' in sample_str:
        labels[int(cid)] = "WhatsApp Cloud Channel"
    elif 'telegram' in files or 'telegram' in sample_str:
        labels[int(cid)] = "Telegram Bot Channel"
    elif 'instagram' in files or 'instagram' in sample_str:
        labels[int(cid)] = "Instagram & Meta Channel"
    elif 'webchat' in files or 'ratelimit' in sample_str:
        labels[int(cid)] = "WebChat Channel & Sessions"
    elif 'providers' in files:
        labels[int(cid)] = "Multi-Channel Provider Layer"
    elif 'onboarding' in files:
        labels[int(cid)] = "Business Onboarding Flow"
    elif 'appshell' in files or 'sidebar' in sample_str:
        labels[int(cid)] = "Navigation & App Shell"
    elif 'package.json' in files:
        labels[int(cid)] = "Project Dependencies"
    elif 'tsconfig.json' in files:
        labels[int(cid)] = "TypeScript Build Config"
    elif 'button' in sample_str or 'drawer' in sample_str or 'index.tsx' in files:
        labels[int(cid)] = "UI Design System Atoms"
    elif 'client.ts' in files:
        labels[int(cid)] = "Frontend API Client"
    elif 'routes.tsx' in files or 'hooks' in files:
        labels[int(cid)] = "React Router & Hooks"
    elif 'auth' in files or 'session' in sample_str:
        labels[int(cid)] = "Authentication & Session Context"
    elif 'tickets' in files:
        labels[int(cid)] = "Support Tickets Module"
    elif 'orders' in files:
        labels[int(cid)] = "Orders & Payments UI"
    elif 'appointments' in files:
        labels[int(cid)] = "Calendar & Appointments Module"
    elif 'lead' in files:
        labels[int(cid)] = "CRM & Leads Pipeline"
    else:
        labels[int(cid)] = f"Module {cid} ({sample_nodes[0] if sample_nodes else 'Core'})"

G = build_from_json(extraction, root='.', directed=False)
communities = {int(k): v for k, v in analysis['communities'].items()}
cohesion = {int(k): v for k, v in analysis['cohesion'].items()}
tokens = {'input': extraction.get('input_tokens', 0), 'output': extraction.get('output_tokens', 0)}

questions = suggest_questions(G, communities, labels)
report = generate(G, communities, cohesion, labels, analysis['gods'], analysis['surprises'], detection, tokens, '.', suggested_questions=questions)

Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding="utf-8")
Path('graphify-out/.graphify_labels.json').write_text(json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding="utf-8")
to_json(G, communities, 'graphify-out/graph.json', community_labels=labels)

print("Step 5 Complete: Community labels and report updated.")

