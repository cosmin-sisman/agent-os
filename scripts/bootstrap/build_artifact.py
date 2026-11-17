# Builds the stack map artifact: embeds the catalog JSON into the template, writes the repo page,
# a claude.ai variant (no document skeleton) and the artifact.yaml with source hashes.
import json, hashlib, sys, os
repo, cat_json, claude_out = sys.argv[1], sys.argv[2], sys.argv[3]
d = {n: json.load(open(os.path.join(cat_json, n + '.json'))) for n in ['layers', 'technologies', 'languages', 'providers', 'runtimes', 'blueprints']}
data = json.dumps(d, ensure_ascii=True, separators=(',', ':')).replace('</', '<\\/')
art = os.path.join(repo, 'artifacts', '2026-11-18-stack-map')
tpl = open(os.path.join(art, 'template.html')).read().replace('__DATA__', data)
open(claude_out, 'w').write(tpl)
title_end = tpl.index('</style>') + len('</style>')
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + tpl[:title_end] + '\n</head>\n<body>\n' + tpl[title_end:] + '\n</body>\n</html>\n')
open(os.path.join(art, 'index.html'), 'w').write(page)
src = []
for n in ['layers', 'technologies', 'languages', 'providers', 'runtimes', 'blueprints']:
    p = f'catalog/{n}.yaml'
    src.append((p, hashlib.sha256(open(os.path.join(repo, p), 'rb').read()).hexdigest()))
src.append(('artifacts/2026-11-18-stack-map/template.html', hashlib.sha256(open(os.path.join(art, 'template.html'), 'rb').read()).hexdigest()))
y = ['# Artifact metadata. Read by `agent-os artifact` (list, verify, link) and by the Pages build.',
     'id: 2026-11-18-stack-map', 'title: "Stack Map"', 'type: stack-map', 'kind: living', 'status: current',
     'summary: "Interactive map of the agent-os catalog: 24 layers, 126 technologies, languages, providers and 10 blueprints by level, with computed stack summaries and a stack.yaml generator."',
     'languages: [en, ro]', 'authors: [cosmin-sisman]', 'refs: []', 'build: "scripts/bootstrap/build_artifact.py, until agent-os artifact build exists"', 'sources:']
y += [f'  - path: {p}\n    sha256: {h}' for p, h in src]
open(os.path.join(art, 'artifact.yaml'), 'w').write('\n'.join(y) + '\n')
print('index.html', os.path.getsize(os.path.join(art, 'index.html')), 'bytes')
