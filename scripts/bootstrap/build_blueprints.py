# One-off: writes catalog/blueprints.yaml (+ JSON for the artifact) and validates every id against the catalog.
import json, sys, os
cat_json, out_yaml, out_json = sys.argv[1], sys.argv[2], sys.argv[3]
L = lambda n: json.load(open(os.path.join(cat_json, n + '.json')))
layers = {x['id'] for x in L('layers')}; techs = {x['id']: x for x in L('technologies')}
langs = {x['id'] for x in L('languages')}; provs = {x['id'] for x in L('providers')}

def T(layer, tech, detail=None, provider=None, runtime=None): return dict(layer=layer, tech=tech, detail=detail, provider=provider, runtime=runtime)
def C(layer, detail, language, provider, runtime=None): return dict(layer=layer, tech=None, detail=detail, language=language, provider=provider, runtime=runtime)

B = [
 dict(id='brochure-site', level=1, family='typescript',
  name={'en': 'Brochure site', 'ro': 'Site de prezentare'},
  description={'en': 'Presentation site with a menu and a contact form', 'ro': 'Site de prezentare cu meniu si formular de contact'},
  takeaway={'en': 'No backend and no database. Built in one or two days, costs almost nothing per month.', 'ro': 'Fara backend si fara baza de date. Se face in 1-2 zile, cost aproape zero pe luna.'},
  layers=[T('public-frontend', 'astro', 'Astro + Tailwind; Astro Actions for the form'), T('email-notifications', 'resend', 'Sends the contact form email'),
          C('storage', 'Images in the repository, served by the CDN', 'none', 'vercel'), T('ci-cd', 'vercel-auto-deploy', 'Deploy on every push')]),
 dict(id='booking-app', level=2, family='typescript',
  name={'en': 'Booking app', 'ro': 'Aplicatie de programari'},
  description={'en': 'Public site, online booking and an admin panel', 'ro': 'Site public, programari online si panou de administrare'},
  takeaway={'en': 'No backend of your own: the BaaS takes its place. Fast and cheap, with limited control.', 'ro': 'Nu ai backend propriu, Supabase ii tine locul. Rapid si ieftin, dar control limitat.'},
  layers=[T('public-frontend', 'astro'), T('internal-frontend', 'vite-react-tanstack-router', 'Vite + React + shadcn admin'),
          T('internal-api', 'supabase-direct-supabase-js-rls'), T('backend-services', 'supabase-edge-functions', 'Booking confirmations'),
          T('background-workers', 'pg-cron', 'Reminder one day before'), C('data-layer', 'Supabase Postgres', 'sql', 'supabase', 'Managed'),
          T('storage', 'supabase-storage'), T('auth', 'supabase-auth'), T('ci-cd', 'github-actions', 'GitHub + Supabase CLI for migrations')]),
 dict(id='b2b-saas', level=3, family='typescript',
  name={'en': 'B2B SaaS', 'ro': 'SaaS B2B'},
  description={'en': 'B2B invoicing SaaS with subscriptions', 'ro': 'SaaS B2B de facturare, cu abonamente'},
  takeaway={'en': 'Your own backend and workers appear. The reference TypeScript stack.', 'ro': 'Apare backend-ul propriu si workerii. Stack-ul TypeScript de referinta.'},
  layers=[T('public-frontend', 'astro', 'Landing, pricing, blog'), T('internal-frontend', 'vite-react-tanstack-router', 'Vite + TanStack Router + shadcn'),
          T('internal-api', 'hono-trpc'), C('public-api-webhooks', 'Incoming Stripe webhooks', 'typescript', 'railway', 'Node.js'),
          T('backend-services', 'modular-monolith-node', 'Invoices, customers, subscriptions'), T('background-workers', 'pg-boss', 'PDFs, emails, reports'),
          T('data-layer', 'drizzle-supabase-postgres'), T('storage', 'supabase-storage', 'Invoice PDFs'), T('auth', 'supabase-auth'),
          T('payments', 'stripe', 'Subscriptions'), T('ci-cd', 'github-actions', 'Staging and production'), T('infrastructure', 'turborepo-pnpm'), T('monitoring', 'sentry')]),
 dict(id='marketplace', level=4, family='typescript',
  name={'en': 'Marketplace with live tracking', 'ro': 'Marketplace cu tracking live'},
  description={'en': 'Customers, restaurants and couriers, with live tracking', 'ro': 'Clienti, restaurante si curieri, cu tracking live'},
  takeaway={'en': 'Mobile apps, a public API, realtime and many more providers appear.', 'ro': 'Apar mobile, API public, realtime si mai multi furnizori.'},
  layers=[T('public-frontend', 'astro', 'Restaurant pages, local SEO', 'cloudflare', 'Edge'), T('internal-frontend', 'vite-react-tanstack-router', 'Restaurant panel + admin', 'cloudflare'),
          T('mobile', 'expo-react-native', 'Two apps: customer and courier'), T('internal-api', 'hono-trpc'),
          T('public-api-webhooks', 'hono-zod-openapi', 'REST for POS systems; Stripe webhooks in, restaurant webhooks out'),
          T('backend-services', 'modular-monolith-node', 'Orders, courier dispatch, payments, fees'), T('background-workers', 'trigger-dev', 'Dispatch, push, settlements'),
          T('realtime', 'supabase-realtime', 'Live courier position'), T('data-layer', 'drizzle-supabase-postgres', 'With PostGIS'),
          T('cache-queue', 'upstash-redis', 'Rate limiting, dispatch sessions'), T('storage', 'supabase-storage'), T('auth', 'supabase-auth', 'Roles: customer, courier, restaurant, admin'),
          T('payments', 'stripe'), T('ci-cd', 'github-actions', 'Monorepo, EAS builds, three environments'), T('monitoring', 'sentry', 'Sentry + Better Stack')]),
 dict(id='enterprise-platform', level=5, family='typescript',
  name={'en': 'Enterprise logistics platform', 'ro': 'Platforma enterprise de logistica'},
  description={'en': 'Fleets, warehouses and ERP integration for a corporate client', 'ro': 'Flote, depozite si integrare ERP pentru un client corporate'},
  takeaway={'en': 'Several languages, each where it belongs; self-hosting and integration with legacy systems.', 'ro': 'Mai multe limbaje, fiecare unde isi are rostul; self-hosting si integrare cu sisteme vechi.'},
  layers=[T('public-frontend', 'next-js', 'Multilingual, 200+ pages'), T('cms', 'sanity'), T('internal-frontend', 'vite-react-tanstack-router', 'Dispatch, maps, reports', 'hetzner', 'Ubuntu (Nginx)'),
          T('mobile', 'expo-react-native', 'Driver app: offline, barcode scanning, signatures; corporate MDM'), T('internal-api', 'hono-trpc', None, 'hetzner', 'Ubuntu, Docker, k3s'),
          T('public-api-webhooks', 'hono-zod-openapi', 'Versioned REST, OAuth client credentials, API gateway', 'hetzner'),
          T('integration-service', 'net-connector', 'Connector to the client\'s SAP / Dynamics ERP'), T('backend-services', 'modular-monolith-node', 'Fleets, orders, billing, SLAs', 'hetzner'),
          T('ai-ml', 'fastapi-pytorch', 'Route optimization, document OCR, forecasts'), T('background-workers', 'bullmq', 'ERP syncs, reports, alerts'),
          T('data-layer', 'postgresql-self-hosted', 'With TimescaleDB for GPS, read replicas'), T('cache-queue', 'redis-self-hosted'),
          T('storage', 'hetzner-object-storage', 'Documents, delivery photos'), T('auth', 'microsoft-entra-id-sso', 'Corporate SSO + Keycloak'),
          T('infrastructure', 'kubernetes-k3s', 'Terraform + k3s'), T('ci-cd', 'github-actions'), T('monitoring', 'grafana-prometheus', 'Grafana + Prometheus, Sentry, backups, audit')]),
 dict(id='cms-site', level=1, family='polyglot',
  name={'en': 'CMS site with bookings', 'ro': 'Site CMS cu rezervari'},
  description={'en': 'Presentation site with online booking and payment', 'ro': 'Site de prezentare cu rezervari online si plata'},
  takeaway={'en': 'PHP and WordPress run a huge part of the web. Good for clients who edit their own content.', 'ro': 'PHP si WordPress tin o parte uriasa din web. Bun pentru clienti care isi editeaza singuri continutul.'},
  layers=[T('public-frontend', 'wordpress', 'Custom theme'), T('internal-frontend', 'wp-admin'),
          C('public-api-webhooks', 'Stripe webhooks through the WooCommerce plugin', 'php', 'digitalocean', 'Ubuntu'),
          C('backend-services', 'WooCommerce + booking plugin', 'php', 'digitalocean', 'PHP-FPM'), C('background-workers', 'WP-Cron for confirmation emails', 'php', 'digitalocean', 'Ubuntu'),
          T('data-layer', 'mysql'), T('storage', 'do-spaces', 'Local disk + backups in Spaces'), C('infrastructure', 'Cloudflare CDN + SSL, daily backups', 'none', 'cloudflare')]),
 dict(id='membership-monolith', level=2, family='polyglot',
  name={'en': 'Membership monolith', 'ro': 'Monolit pentru abonamente'},
  description={'en': 'Gym memberships, QR check-in and a front-desk panel', 'ro': 'Abonamente, check-in cu QR si panou pentru receptie'},
  takeaway={'en': 'A full-stack monolith with no separate frontend. One developer ships very fast.', 'ro': 'Monolit full-stack, fara frontend separat. Un singur developer livreaza foarte repede.'},
  layers=[T('public-frontend', 'rails-hotwire'), T('internal-frontend', 'rails-hotwire-admin', 'Front desk, admin'),
          C('public-api-webhooks', 'Stripe webhooks for subscriptions', 'ruby', 'render', 'Docker'), T('backend-services', 'rails-services'),
          T('background-workers', 'sidekiq', 'Renewals, emails'), C('data-layer', 'PostgreSQL (managed)', 'sql', 'render', 'Managed'),
          C('cache-queue', 'Redis (managed)', 'none', 'render', 'Managed'), T('storage', 'aws-s3', 'Active Storage'), T('ci-cd', 'github-actions')]),
 dict(id='mobile-first-app', level=3, family='polyglot',
  name={'en': 'Mobile-first coaching app', 'ro': 'Aplicatie mobile-first de coaching'},
  description={'en': 'Fitness app: plans, progress, chat with the coach', 'ro': 'Aplicatie mobila de fitness: planuri, progres, chat cu antrenorul'},
  takeaway={'en': 'Mobile first. Flutter looks identical on iOS and Android; Django ships with an admin.', 'ro': 'Mobile-first. Flutter arata identic pe iOS si Android; Django vine cu admin gata facut.'},
  layers=[T('public-frontend', 'hugo', None, 'cloudflare', 'Edge'), T('internal-frontend', 'django-admin', 'For coaches'), T('mobile', 'flutter', 'iOS + Android'),
          T('internal-api', 'django-rest-framework'), C('public-api-webhooks', 'RevenueCat webhooks (in-app subscriptions)', 'python', 'digitalocean', 'Docker'),
          T('backend-services', 'django-apps', 'Plans, progress, chat'), T('background-workers', 'celery', 'Notifications, statistics'), T('realtime', 'django-channels', 'Chat'),
          C('data-layer', 'PostgreSQL (managed)', 'sql', 'digitalocean', 'Managed'), C('cache-queue', 'Redis (managed)', 'none', 'digitalocean', 'Managed'),
          T('storage', 'do-spaces', 'Exercise videos + CDN'), T('email-notifications', 'firebase-cloud-messaging'), T('ci-cd', 'codemagic', 'Flutter builds; GitHub Actions'), T('monitoring', 'sentry')]),
 dict(id='fintech-wallet', level=4, family='polyglot',
  name={'en': 'Fintech wallet', 'ro': 'Portofel digital fintech'},
  description={'en': 'Digital wallet: transfers, virtual cards, KYC', 'ro': 'Portofel digital: transferuri, carduri virtuale, KYC'},
  takeaway={'en': 'Java and Kotlin dominate fintech; the mobile apps are fully native.', 'ro': 'In fintech domina Java/Kotlin; aplicatiile mobile sunt native pure.'},
  layers=[T('public-frontend', 'next-js'), T('internal-frontend', 'angular', 'Back-office: compliance, support'),
          T('mobile', 'swiftui-native-ios', 'Swift (iOS) + Kotlin (Android), fully native'), T('internal-api', 'spring-boot', 'Kotlin BFF for mobile'),
          T('public-api-webhooks', 'go-chi-gin', 'API gateway, Open Banking (PSD2)', 'aws'), T('backend-services', 'spring-boot-services', 'Core ledger, transfers, limits, anti-fraud'),
          T('background-workers', 'kafka-consumers', 'Reconciliation, notifications'), C('ai-ml', 'KYC: document checks, risk scoring', 'python', 'aws', 'Docker'),
          T('data-layer', 'aurora-postgresql', 'Strict transactions'), C('cache-queue', 'Redis (ElastiCache)', 'none', 'aws', 'Managed'),
          T('storage', 'aws-s3', 'Encrypted KYC documents'), T('auth', 'keycloak', '2FA, biometrics', 'aws'),
          T('infrastructure', 'terraform'), T('ci-cd', 'argocd', 'Kubernetes GitOps'), T('monitoring', 'datadog', 'Audit and compliance')]),
 dict(id='live-streaming-platform', level=5, family='polyglot',
  name={'en': 'Live streaming and games platform', 'ro': 'Platforma de streaming live si jocuri'},
  description={'en': 'Live streaming and multiplayer games for millions of users', 'ro': 'Streaming live si jocuri multiplayer, milioane de utilizatori'},
  takeaway={'en': 'Each language chosen for one role: Elixir for connections, Rust and C++ for video, Go for services, Python for ML.', 'ro': 'Fiecare limbaj ales pentru un singur rol: Elixir conexiuni, Rust/C++ video, Go servicii, Python ML.'},
  layers=[T('public-frontend', 'sveltekit', 'Channel pages, SEO'), T('internal-frontend', 'vite-react-tanstack-router', 'Moderation, analytics, admin', 'cloudflare'),
          T('mobile', 'expo-react-native', 'With native video modules'), T('desktop-tv', 'electron', 'Desktop; Kotlin for Android TV'),
          T('internal-api', 'graphql-gateway-go', 'Federated gateway'), T('public-api-webhooks', 'go-chi-gin', 'REST for streamers, bots, OBS', 'hetzner'),
          T('realtime', 'phoenix-channels', 'Chat and presence, millions of WebSocket connections', 'hetzner'), T('video-media', 'rust-ffmpeg', 'RTMP / WebRTC ingest, processing'),
          T('game-servers', 'cpp-lua', 'Real-time multiplayer logic'), T('backend-services', 'go-microservices', 'Accounts, payments, subscriptions'),
          T('ai-ml', 'fastapi-pytorch', 'Personalized feed, automatic moderation'), T('background-workers', 'kafka-consumers', 'Events, clips, notifications (Go / Rust)', 'hetzner'),
          T('data-layer', 'scylladb', 'ScyllaDB for chat volume + PostgreSQL for accounts'), T('analytics', 'clickhouse'), T('storage', 'cloudflare-r2', 'VOD, clips + video CDN'),
          T('infrastructure', 'kubernetes-k3s', 'Kubernetes, Terraform, Ansible'), T('monitoring', 'grafana-prometheus', 'Prometheus + Grafana, OpenTelemetry')]),
]
errs = []
for b in B:
    for r in b['layers']:
        if r['layer'] not in layers: errs.append((b['id'], 'layer', r['layer']))
        if r['tech'] and r['tech'] not in techs: errs.append((b['id'], 'tech', r['tech']))
        if r.get('provider') and r['provider'] not in provs: errs.append((b['id'], 'provider', r['provider']))
        if r.get('language') and r['language'] not in langs: errs.append((b['id'], 'language', r['language']))
assert not errs, errs
json.dump(B, open(out_json, 'w'), ensure_ascii=True)

q = lambda s: json.dumps(s, ensure_ascii=True)
out = ['# Reference stacks by complexity level (1 simple .. 5 complex), in two families:',
       '# typescript (one language end to end) and polyglot (each language where it fits).',
       '# /kickoff proposes one of these; `agent-os stack new --from <id>` turns it into a stack.yaml.',
       '# A row has either `tech` (an id from technologies.yaml) or a free `detail` with language and provider ids.', '']
for b in B:
    out += [f"- id: {b['id']}", f"  level: {b['level']}", f"  family: {b['family']}"]
    for k in ('name', 'description', 'takeaway'):
        out += [f'  {k}:', f"    en: {q(b[k]['en'])}", f"    ro: {q(b[k]['ro'])}"]
    out.append('  layers:')
    for r in b['layers']:
        out.append(f"    - layer: {r['layer']}")
        if r['tech']: out.append(f"      tech: {r['tech']}")
        for k in ('detail', 'language', 'provider', 'runtime'):
            if r.get(k): out.append(f"      {k}: {r[k] if k in ('language', 'provider') else q(r[k])}")
    out.append('')
open(out_yaml, 'w').write('\n'.join(out))
print('blueprints', len(B), 'rows', sum(len(b['layers']) for b in B))
