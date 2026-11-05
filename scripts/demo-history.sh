#!/usr/bin/env bash
# Rebuilds the live demo: replays the example as a git history (so time-lapse,
# history and the PR renovation have something to show) and exports blueprint-demo.html.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../examples/ride-hailing" && pwd)"
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js"
DIR="${1:-/tmp/ride-hailing-history}"
rm -rf "$DIR" && mkdir -p "$DIR" && cd "$DIR"
git init -q -b main && git config user.email demo@example.com && git config user.name Mateus
c() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git -c user.name="$2" commit -qm "$3"; }
cp "$SRC/package.json" "$SRC/tsconfig.json" . && mkdir -p packages/shared/src services
cp "$SRC/packages/shared/package.json" packages/shared/ && cp "$SRC"/packages/shared/src/{logger,errors}.ts packages/shared/src/
printf "export { logger } from './logger';\nexport { AppError, NotFound } from './errors';\n" > packages/shared/src/index.ts
git add -A && c 2025-03-02T10:00:00 Mateus "chore: shared logger and errors"
cp "$SRC"/packages/shared/src/*.ts packages/shared/src/ && cp -r "$SRC/services/users" services/ && git add -A && c 2025-04-14T10:00:00 Mateus "feat(users): token verification and user repo"
cp -r "$SRC/services/gateway" services/ && git add -A && c 2025-05-20T10:00:00 Ana "feat(gateway): public API with auth middleware"
cp -r "$SRC/services/rides" services/ && rm services/rides/src/clients/geo.ts && sed -i "/driversNear/d" services/rides/src/domain/matching.ts && git add -A && c 2025-07-03T10:00:00 Mateus "feat(rides): matching, eta and pricing client"
cp -r "$SRC/services/payments" services/ && rm services/payments/src/{http,reports}.ts && sed -i "/registerRoutes/d" services/payments/src/index.ts && git add -A && c 2025-08-28T10:00:00 Ana "feat(payments): stripe ledger"
cp -r "$SRC/services/notifications" services/ && git add -A && c 2025-10-09T10:00:00 Joao "feat(notifications): push and email"
cp -r "$SRC/services/pricing" services/ && git add -A && c 2026-01-15T10:00:00 Ana "feat(pricing): python pricing service"
cp "$SRC"/services/payments/src/{http,reports,index}.ts services/payments/src/ && git add -A && c 2026-04-02T10:00:00 Joao "feat(payments): monthly reports endpoint"
cp -r "$SRC/services/geo" services/ && cp "$SRC/services/rides/src/clients/geo.ts" services/rides/src/clients/ && cp "$SRC/services/rides/src/domain/matching.ts" services/rides/src/domain/ && cp "$SRC/docker-compose.yml" . && git add -A && c 2026-07-21T10:00:00 Mateus "feat(geo): go geo service + docker-compose"
echo ".blueprint" > .gitignore && git add .gitignore && git commit -qm "chore: ignore blueprint cache"
node "$CLI" timelapse . -n 10
# a pull request that adds a crack and a command-injection route
git checkout -qb feature/cache-invalidation
cat > services/users/src/cache.ts <<'TS'
import { verifyToken } from './tokens';
const url = process.env.REDIS_URL;
const store = new Map<string, string>();
export const cache = { get: (k: string) => store.get(k), set: (k: string, v: string) => store.set(k, v), url };
export function refresh(token: string) { store.set(token, verifyToken(token).userId); }
TS
cat > services/users/src/admin.ts <<'TS'
import { execSync } from 'node:child_process';
type App = { post: (path: string, h: (req: any) => unknown) => void };
export function adminRoutes(app: App) {
  app.post('/admin/backup', (req) => execSync(`pg_dump ${req.body.database} > /tmp/backup.sql`));
}
TS
sed -i "s#import { findUser } from './repo/userRepo';#import { findUser } from './repo/userRepo';\nimport { adminRoutes } from './admin';\nadminRoutes({ post: () => undefined });#" services/users/src/index.ts
git add -A && git -c user.name=Ana commit -qm "feat(users): cache refresh + admin backup"
cp "$SRC"/.blueprint/{annotations,overview,notes}.json .blueprint/
node "$CLI" diff . --base main --html "${OUT:-$OLDPWD/blueprint-demo.html}"
