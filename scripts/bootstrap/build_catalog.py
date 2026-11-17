# One-off: turns the extracted stack cheatsheet into agent-os catalog JSON (en + ASCII ro).
import json, sys, re, unicodedata, os
src, outdir = sys.argv[1], sys.argv[2]
d = json.load(open(src))

def ascii_ro(s):
    if s is None: return None
    s = s.replace('–', '-').replace('—', '-').replace('„', '"').replace('”', '"').replace('→', '->')
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c))

def slug(s):
    special = {'C#': 'csharp', 'C++': 'cpp', 'C++ + Lua': 'cpp-lua'}
    if s in special: return special[s]
    s = ascii_ro(s).lower().replace('+', ' ').replace('.', ' ').replace('#', ' sharp ')
    s = re.sub(r'\(.*?\)', lambda m: ' ' + m.group(0)[1:-1] + ' ', s)
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def num(x):
    try: return int(x)
    except: return None

LAYER_EN = {
 'Public Frontend': ('Public site: marketing, SEO, AI agents', 'experience'),
 'Internal Frontend': ('The web app behind login, back-office', 'experience'),
 'Mobile': ('iOS and Android apps', 'experience'),
 'Desktop / TV': ('Desktop or TV apps', 'experience'),
 'Internal API': ('First-party API for your own clients', 'interfaces'),
 'Public API + Webhooks': ('API for partners; incoming and outgoing webhooks', 'interfaces'),
 'Integration Service': ('Connectors to external or legacy systems', 'interfaces'),
 'Backend Services': ('Business logic (service layer)', 'logic'),
 'Background Workers': ('Jobs, queues, cron', 'logic'),
 'Realtime': ('Live events, chat, presence', 'logic'),
 'AI / ML': ('LLMs, models, intelligent processing', 'logic'),
 'Video / Media': ('Streaming, video and audio processing', 'logic'),
 'Servere de joc': ('Real-time multiplayer logic', 'logic'),
 'Data Layer': ('Main database and ORM', 'data'),
 'Cache / Queue': ('Cache, rate limiting, message queues', 'data'),
 'Analytics': ('Events, reports, BI', 'data'),
 'Storage': ('Files, images, video', 'data'),
 'Auth': ('Authentication and authorization', 'platform'),
 'CMS': ('Content the client edits', 'platform'),
 'Email / Notificări': ('Transactional email, push, SMS', 'platform'),
 'Plăți': ('Payments, subscriptions, billing', 'platform'),
 'CI/CD': ('Build, tests, automatic deploy', 'delivery'),
 'Infrastructure': ('Containers, orchestration, IaC, monorepo', 'delivery'),
 'Monitoring': ('Errors, logs, metrics, uptime', 'delivery'),
}
LAYER_NAME_EN = {'Servere de joc': 'Game Servers', 'Email / Notificări': 'Email / Notifications', 'Plăți': 'Payments'}
LAYER_NAME_RO = {'Public Frontend': 'Frontend public', 'Internal Frontend': 'Frontend intern', 'Mobile': 'Mobil',
 'Desktop / TV': 'Desktop / TV', 'Internal API': 'API intern', 'Public API + Webhooks': 'API public + webhooks',
 'Integration Service': 'Serviciu de integrare', 'Backend Services': 'Servicii backend', 'Background Workers': 'Workeri in fundal',
 'Realtime': 'Realtime', 'AI / ML': 'AI / ML', 'Video / Media': 'Video / media', 'Servere de joc': 'Servere de joc',
 'Data Layer': 'Strat de date', 'Cache / Queue': 'Cache / cozi', 'Analytics': 'Analytics', 'Storage': 'Stocare',
 'Auth': 'Autentificare', 'CMS': 'CMS', 'Email / Notificări': 'Email / notificari', 'Plăți': 'Plati', 'CI/CD': 'CI/CD',
 'Infrastructure': 'Infrastructura', 'Monitoring': 'Monitorizare'}

TECH_EN = {
 'Astro': 'Zero JS by default, ideal for SEO and AI agents', 'Next.js': 'SSR/ISR, suited to large multilingual sites',
 'SvelteKit': 'Fast, small bundle', 'Nuxt': 'The Vue counterpart of Next', 'Hugo': 'Very fast static generator',
 'WordPress': 'The client edits content on their own', 'Laravel + Blade': 'Full-stack PHP monolith',
 'Rails + Hotwire': 'Full-stack Ruby monolith', 'Webflow': 'No-code, for presentation sites',
 'Vite + React + TanStack Router': 'Default choice for apps behind login', 'Next.js (app)': 'When there is no separate backend',
 'Vue + Vite': 'Alternative to React', 'Angular': 'Enterprise, large back-office', 'Refine / React Admin': 'Generated CRUD admin, fast',
 'Django Admin': 'Admin generated from the models', 'Rails + Hotwire (admin)': 'Admin inside the Rails monolith', 'WP Admin': 'Included in WordPress',
 'Expo (React Native)': 'Native, shares logic and types with the web', 'Flutter': 'Identical UI on iOS and Android',
 'SwiftUI (iOS nativ)': 'Maximum performance and access on iOS', 'Jetpack Compose (Android nativ)': 'Maximum performance and access on Android',
 'Capacitor': 'The web app wrapped natively, small budget', 'PWA': 'No app store, limits on iOS',
 'Electron': 'Desktop with web technologies', 'Tauri': 'Lightweight desktop, Rust backend', 'Android TV (Kotlin)': 'TV apps',
 'Hono + tRPC': 'Type-safe between backend and TS clients', 'Hono + oRPC': 'Type-safe plus OpenAPI from one definition',
 'NestJS': 'Enterprise structure on Node', 'FastAPI': 'Fast Python API, automatic docs', 'Django REST Framework': 'API on top of Django models',
 'Laravel': 'Mature PHP API', 'Spring Boot': 'Enterprise, fintech', 'ASP.NET Core': 'Microsoft ecosystem',
 'GraphQL gateway (Go)': 'Federation over many microservices', 'Supabase direct (supabase-js + RLS)': 'No own backend, security through RLS',
 'Hono + zod-openapi': 'Versioned REST with OpenAPI docs', 'Go (chi / gin)': 'Fast API gateway', 'Kong API Gateway': 'Rate limiting, API keys, routing',
 'Svix (webhooks trimise)': 'Outgoing webhooks with retries and signatures', 'Conector .NET': 'Legacy ERP integration (SAP, Dynamics)',
 'n8n': 'Visual automations, self-hosted', 'Spring Integration / Camel': 'Complex enterprise integrations',
 'Modular monolith (Node)': 'One service layer shared by every API', 'Supabase Edge Functions': 'Small functions, no own server',
 'Django apps': 'Logic in Python', 'Rails services': 'Logic in Ruby', 'Spring Boot services': 'Strict transactions, enterprise',
 'Go microservicii': 'Scaling by separate services', 'Elixir Phoenix': 'Massive concurrency, fault tolerance',
 'pg-boss': 'Queues in Postgres, no Redis', 'Trigger.dev': 'Durable jobs, managed', 'Inngest': 'Event-driven workflows',
 'BullMQ': 'Fast queues on Redis', 'Celery': 'The Python standard', 'Sidekiq': 'The Rails standard', 'Kafka consumers': 'High event volumes',
 'pg_cron': 'Cron inside the database', 'Supabase Realtime': 'Postgres Changes plus Broadcast', 'Socket.IO': 'Classic WebSockets',
 'Phoenix Channels': 'Millions of connections', 'Django Channels': 'WebSockets in Django', 'Ably': 'Managed realtime',
 'Claude API (Anthropic SDK)': 'LLM for generation, extraction, agents', 'Vercel AI SDK': 'AI chat and streaming in TS',
 'pgvector (RAG)': 'Semantic search in Postgres', 'FastAPI + PyTorch': 'Own models, ML', 'Mux': 'Video on demand and live, managed',
 'Cloudflare Stream': 'Simple, cheap video', 'Rust + FFmpeg': 'Own video processing', 'Colyseus': 'Multiplayer in TS',
 'Nakama': 'Open-source game server', 'C++ + Lua': 'Maximum performance', 'Drizzle + Supabase Postgres': 'Default data layer in the reference stack',
 'Prisma + Neon Postgres': 'Popular ORM, serverless Postgres', 'PostgreSQL self-hosted': 'Full control, low cost',
 'Aurora PostgreSQL': 'Enterprise, high availability', 'MySQL': 'WordPress, Laravel', 'MongoDB Atlas': 'Documents, flexible schema',
 'Firestore': 'Realtime NoSQL', 'ScyllaDB': 'Huge volumes (chat, events), CQL', 'Upstash Redis': 'Serverless Redis, pay per request',
 'Redis self-hosted': 'Cache and queues', 'RabbitMQ': 'Classic message broker', 'Kafka': 'Event streaming at scale',
 'PostHog': 'Product analytics, feature flags', 'Metabase': 'BI dashboards', 'ClickHouse': 'Billions of events',
 'Supabase Storage': 'Integrated with Supabase Auth', 'Cloudflare R2': 'S3-compatible, no egress fees', 'AWS S3': 'The industry standard',
 'DO Spaces': 'S3-compatible plus CDN', 'Hetzner Object Storage': 'S3-compatible, cheap, EU', 'Supabase Auth': 'Email, OAuth, magic link, JWT',
 'Clerk': 'Ready-made login UI', 'Better Auth': 'Self-hosted auth in TS', 'Firebase Auth': 'Simple auth for mobile',
 'Keycloak': 'Self-hosted enterprise SSO', 'Microsoft Entra ID (SSO)': 'SSO for corporate clients', 'Sanity': 'Flexible headless CMS',
 'Payload CMS': 'Self-hosted headless CMS', 'Keystatic': 'Content in the repo, visual editor', 'WordPress (headless)': 'The editor clients already know',
 'Resend': 'Transactional email', 'Expo Push': 'Push for Expo apps', 'Firebase Cloud Messaging': 'iOS/Android push', 'Twilio (SMS)': 'SMS, WhatsApp',
 'Stripe': 'Payments and subscriptions', 'RevenueCat': 'In-app subscriptions (App Store / Play)', 'Netopia': 'Romanian payment processor',
 'GitHub Actions': 'Lint, tests, deploy', 'Vercel auto-deploy': 'Deploy on every push', 'EAS Build': 'Mobile builds plus OTA updates',
 'Codemagic': 'CI for Flutter', 'ArgoCD': 'GitOps for Kubernetes', 'Turborepo + pnpm': 'Monorepo', 'Docker': 'Containers',
 'Coolify': 'Self-hosted PaaS (Railway alternative)', 'Kubernetes (k3s)': 'Container orchestration', 'Terraform': 'Infrastructure as code',
 'Ansible': 'Server configuration', 'Sentry': 'Frontend and backend errors', 'Better Stack': 'Logs and uptime',
 'Datadog': 'Enterprise observability', 'Grafana + Prometheus': 'Self-hosted metrics', 'OpenTelemetry': 'Standardized tracing',
}
TECH_NAME_EN = {'SwiftUI (iOS nativ)': 'SwiftUI (native iOS)', 'Jetpack Compose (Android nativ)': 'Jetpack Compose (native Android)',
 'Svix (webhooks trimise)': 'Svix (outgoing webhooks)', 'Conector .NET': '.NET connector', 'Go microservicii': 'Go microservices'}

LANG_EN = {
 'TypeScript': ('Web / general', 'Static types, one language for everything', 'Frontend, backend, mobile'),
 'JavaScript': ('Web', 'Runs everywhere', 'Mostly as compiled TypeScript'),
 'Python': ('General / AI', 'AI, data, built-in admin (Django)', 'ML, data-heavy backends, scraping'),
 'PHP': ('Web', 'Huge ecosystem, cheap hosting', 'Sites, e-commerce, CMS'),
 'Ruby': ('Web', 'Maximum early productivity', 'MVPs, SaaS'),
 'Go': ('Backend / systems', 'Simple, fast, low memory', 'Microservices, API gateways, DevOps'),
 'Rust': ('Systems', 'C++ speed with memory safety', 'Video, infrastructure, critical components'),
 'Java': ('Enterprise', 'Stability, enterprise ecosystem', 'Banks, fintech, corporations'),
 'Kotlin': ('JVM / Android', 'Modern, concise Java', 'Android, Spring backends'),
 'C#': ('Enterprise', 'Microsoft ecosystem', 'ERP integrations, enterprise, Unity games'),
 'Swift': ('Mobile', 'Full access to iOS', 'Native iOS apps'),
 'Dart': ('Mobile', 'One codebase, identical UI on iOS and Android', 'Flutter'),
 'Elixir': ('Realtime', 'Millions of connections, fault tolerance', 'Chat, presence, realtime'),
 'C++': ('Systems', 'Absolute performance', 'Game engines, video, embedded'),
 'Lua': ('Scripting', 'Light, embeddable scripting', 'Game logic, Nginx/Kong'),
 'SQL': ('Data', 'The language of databases', 'Queries, migrations, row-level security'),
 'YAML': ('Configuration', 'Readable configuration', 'CI/CD, Docker, Kubernetes'),
 'HCL': ('Configuration / IaC', 'Infrastructure as code', 'Terraform'),
 'Assembly': ('Low-level', 'Full control of the hardware', 'Not on the web: firmware, drivers'),
 'N/A (serviciu)': ('—', 'You configure, you do not write code', 'Managed services (payments, email, auth)'),
}
PROV_EN = {
 'Vercel': ('Frontend PaaS', 'Frontends (Astro, Next, Vite)'), 'Cloudflare': ('Edge / CDN', 'Edge frontends, CDN, R2, Stream'),
 'Netlify': ('Frontend PaaS', 'Static frontends'), 'Railway': ('PaaS', 'Managed backends and workers'),
 'Render': ('PaaS', 'Backends, workers, managed Postgres'), 'Fly.io': ('PaaS', 'Apps close to users'),
 'DigitalOcean': ('IaaS / PaaS', 'VPS, App Platform, managed DBs'), 'Hetzner': ('IaaS', 'Cheap EU servers, self-hosting'),
 'AWS': ('Full cloud', 'Enterprise, fintech'), 'Azure': ('Full cloud', 'Microsoft clients, corporate SSO'),
 'Supabase': ('BaaS', 'Postgres, Auth, Storage, Realtime'), 'Firebase': ('BaaS', 'Mobile, push, NoSQL'),
 'Neon': ('Serverless DB', 'Serverless Postgres'), 'MongoDB Atlas': ('Managed DB', 'Managed MongoDB'),
 'Upstash': ('Serverless data', 'Serverless Redis and queues'), 'Trigger.dev': ('Jobs', 'Managed background jobs'),
 'Inngest': ('Jobs', 'Event-driven workflows'), 'Resend': ('Email', 'Transactional email'), 'Twilio': ('SMS', 'SMS, WhatsApp, voice'),
 'Stripe': ('Payments', 'Payments and subscriptions'), 'RevenueCat': ('Mobile payments', 'In-app subscriptions'),
 'Netopia': ('Payments', 'Payments in Romania'), 'Clerk': ('Auth', 'Auth with ready-made UI'), 'Sanity': ('CMS', 'Headless CMS'),
 'Anthropic': ('AI API', 'Claude API'), 'Ably': ('Realtime', 'Managed realtime'), 'Svix': ('Webhooks', 'Outgoing webhooks'),
 'Mux': ('Video', 'Managed video'), 'PostHog': ('Analytics', 'Product analytics'), 'Sentry': ('Monitoring', 'Errors'),
 'Better Stack': ('Monitoring', 'Logs, uptime'), 'Datadog': ('Monitoring', 'Enterprise observability'),
 'Grafana Cloud': ('Monitoring', 'Metrics, tracing'), 'GitHub': ('Code / CI', 'Repositories, Actions'),
 'EAS (Expo)': ('Mobile CI', 'Expo builds and updates'), 'Codemagic': ('Mobile CI', 'Flutter builds'),
 'App Store / Play': ('Distribution', 'Publishing mobile apps'), 'Webflow': ('No-code', 'No-code sites'),
 'Datacenter client': ('On-premise', "The client's own infrastructure"),
}
PROV_NAME_EN = {'Datacenter client': 'Client datacenter'}
# Providers with an official or widely used MCP server to look for. /env verifies; never assumed installed.
MCP_HINT = {'Vercel', 'Cloudflare', 'Netlify', 'Railway', 'Render', 'DigitalOcean', 'AWS', 'Azure', 'Supabase', 'Firebase', 'Neon',
 'MongoDB Atlas', 'Upstash', 'Trigger.dev', 'Resend', 'Stripe', 'Sanity', 'PostHog', 'Sentry', 'Datadog', 'Grafana Cloud', 'GitHub'}
EU = {'Da': 'yes', 'Global': 'global', 'Verifică': 'verify', '—': 'n/a'}
RT_EN = {
 'Ubuntu': ('Linux server', '~95% of servers, almost always with Docker'), 'Debian': ('Linux server', 'Stable alternative to Ubuntu'),
 'Alpine': ('Minimal Linux', 'Small Docker images'),
 'Windows Server': ('Windows', 'Only for legacy .NET Framework, Active Directory or client requirements'),
 'Serverless': ('Managed', 'Functions on demand; you do not manage the OS'), 'Edge': ('Managed', 'Runs in hundreds of locations'),
 'Static / CDN': ('Managed', 'Only HTML/JS/CSS files served from a CDN'), 'Managed': ('Managed', 'The provider runs everything'),
 'iOS / Android': ('Mobile', 'Apps installed on the phone'), 'JVM / BEAM / Node.js / Deno': ('Runtime', 'Where the code runs, on top of the OS'),
}

layers = []
for r in d['Config Straturi'][1:]:
    name = r['A']; desc_en, group = LAYER_EN[name]
    layers.append({'id': slug(LAYER_NAME_EN.get(name, name)), 'group': group,
                   'name': {'en': LAYER_NAME_EN.get(name, name), 'ro': LAYER_NAME_RO[name]},
                   'description': {'en': desc_en, 'ro': ascii_ro(r.get('B'))}})
layer_id = {r['A']: l['id'] for r, l in zip(d['Config Straturi'][1:], layers)}
langs = []
for r in d['Config Limbaje'][1:]:
    kind, strength, use = LANG_EN[r['A']]
    lid = 'none' if r['A'].startswith('N/A') else slug(r['A'])
    langs.append({'id': lid, 'name': 'N/A (service)' if lid == 'none' else r['A'], 'kind': kind,
                  'performance': num(r.get('C')), 'learningCurve': num(r.get('D')), 'aiFriendly': num(r.get('E')),
                  'strength': {'en': strength, 'ro': ascii_ro(r.get('F'))},
                  'typicalUse': {'en': use, 'ro': ascii_ro(r.get('G')).replace(' - standardul agentiei', '')}})
lang_id = {r['A']: l['id'] for r, l in zip(d['Config Limbaje'][1:], langs)}
provs = []
for r in d['Config Furnizori'][1:]:
    kind, role = PROV_EN[r['A']]
    n = PROV_NAME_EN.get(r['A'], r['A'])
    provs.append({'id': slug(n), 'name': n, 'kind': kind, 'ease': num(r.get('C')), 'cost': num(r.get('D')),
                  'euRegions': EU[r.get('E', '—')], 'mcpHint': r['A'] in MCP_HINT,
                  'role': {'en': role, 'ro': ascii_ro(r.get('F'))}})
prov_id = {r['A']: p['id'] for r, p in zip(d['Config Furnizori'][1:], provs)}
techs = []
for r in d['Config Tehnologii'][1:]:
    n = TECH_NAME_EN.get(r['A'], r['A'])
    techs.append({'id': slug(n), 'name': n, 'layer': layer_id[r['B']], 'language': lang_id[r['C']], 'provider': prov_id[r['D']],
                  'runtime': r.get('E'), 'complexity': num(r.get('F')), 'aiFriendly': num(r.get('G')),
                  'note': {'en': TECH_EN[r['A']], 'ro': ascii_ro(r.get('H')).replace('Standardul agentiei', 'Alegerea implicita')}})
rts = []
for r in d['Config OS'][1:]:
    kind, when = RT_EN[r['A']]
    rts.append({'id': slug(r['A']), 'name': r['A'], 'kind': kind, 'when': {'en': when, 'ro': ascii_ro(r.get('C'))}})

ids = [t['id'] for t in techs]; assert len(ids) == len(set(ids)), 'duplicate tech ids'
os.makedirs(outdir, exist_ok=True)
SAFE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
def scalar(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, int): return str(v)
    return v if SAFE.match(v) and v not in ('yes', 'no', 'null', 'true', 'false', 'none', 'on', 'off') else json.dumps(v, ensure_ascii=True)
def emit(items, header):
    out = [header, '']
    for it in items:
        first = True
        for k, v in it.items():
            pre = '- ' if first else '  '; first = False
            if isinstance(v, dict):
                out.append(f'{pre}{k}:')
                for k2, v2 in v.items(): out.append(f'    {k2}: {scalar(v2)}')
            else:
                out.append(f'{pre}{k}: {scalar(v)}')
        out.append('')
    return '\n'.join(out)
HEAD = {
 'layers': '# The layers of a software system. A project maps its stack, its area:* labels and its paths onto these ids.\n# group: experience | interfaces | logic | data | platform | delivery',
 'technologies': '# Technologies per layer. complexity: 1 simple .. 5 complex. aiFriendly: 1 agents know it poorly .. 5 very well.\n# layer, language and provider are ids from layers.yaml, languages.yaml and providers.yaml.',
 'languages': '# Languages. performance: 1 slow .. 5 very fast. learningCurve: 1 easy .. 5 hard. aiFriendly: 1 poorly known by agents .. 5 very well.',
 'providers': '# Providers. ease: 5 = very simple. cost: 1 cheap .. 5 expensive (relative, indicative).\n# euRegions: yes | global | verify (confirm in the provider docs before strict GDPR work) | n/a\n# mcpHint: an MCP server is worth looking for; agent-os env verifies it, never assumes it.',
 'runtimes': '# OS and runtimes, for the runtime field of a stack layer.',
}
for name, data in [('layers', layers), ('technologies', techs), ('languages', langs), ('providers', provs), ('runtimes', rts)]:
    with open(os.path.join(outdir, name + '.yaml'), 'w') as f:
        f.write(emit(data, HEAD[name]))
    with open(os.path.join(sys.argv[3], name + '.json'), 'w') as f:
        json.dump(data, f, ensure_ascii=True)
print({k: len(v) for k, v in [('layers', layers), ('technologies', techs), ('languages', langs), ('providers', provs), ('runtimes', rts)]})
