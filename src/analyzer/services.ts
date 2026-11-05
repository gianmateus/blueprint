import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import YAML from 'yaml';
import type { ServiceInfo } from '../types.js';

export interface ComposeService {
  name: string;
  /** absolute build context, if the service is built from this repo */
  dir?: string;
  image?: string;
  env: Record<string, string>;
  dependsOn: string[];
  ports: string[];
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', '**/docker-compose.yml', '**/docker-compose.yaml', '**/compose.yml', '**/compose.yaml'];

/** Images that are infrastructure (databases, caches, queues, proxies) rather than app code. */
const INFRA_IMAGE = /postgres|mysql|mariadb|mongo|redis|valkey|memcached|rabbitmq|kafka|zookeeper|nats|elasticsearch|opensearch|minio|localstack|clickhouse|cassandra|neo4j|nginx|traefik|envoy|consul|vault|jaeger|prometheus|grafana|otel|mailhog|mailpit|keycloak|dynamodb|cockroach|timescale|influx|etcd|temporal/i;

export function findComposeServices(root: string, ignore: string[]): ComposeService[] {
  const files = fg.sync(COMPOSE_FILES, { cwd: root, absolute: true, ignore, deep: 3, unique: true });
  const seen = new Map<string, ComposeService>();
  for (const file of files) {
    let doc: any;
    try {
      doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const services = doc?.services;
    if (!services || typeof services !== 'object') continue;
    const base = path.dirname(file);
    for (const [name, raw] of Object.entries<any>(services)) {
      if (seen.has(name) || !raw || typeof raw !== 'object') continue;
      const build = raw.build;
      const ctx = typeof build === 'string' ? build : build?.context;
      const dir = ctx ? path.resolve(base, ctx) : undefined;
      const env: Record<string, string> = {};
      if (Array.isArray(raw.environment)) {
        for (const kv of raw.environment) {
          const s = String(kv);
          const i = s.indexOf('=');
          if (i > 0) env[s.slice(0, i)] = s.slice(i + 1);
        }
      } else if (raw.environment && typeof raw.environment === 'object') {
        for (const [k, v] of Object.entries(raw.environment)) env[k] = v == null ? '' : String(v);
      }
      const dependsOn = Array.isArray(raw.depends_on) ? raw.depends_on.map(String) : raw.depends_on ? Object.keys(raw.depends_on) : [];
      const ports = Array.isArray(raw.ports) ? raw.ports.map((p: any) => (typeof p === 'object' ? `${p.published ?? ''}:${p.target ?? ''}` : String(p))) : [];
      seen.set(name, { name, dir, image: raw.image, env, dependsOn, ports });
    }
  }
  return [...seen.values()];
}

export function isInfra(s: ComposeService): boolean {
  if (s.dir) return false;
  return !s.image || INFRA_IMAGE.test(s.image);
}

/** Does `value` point at host `host`? (http://host:3000, postgres://u:p@host:5432/db, host:6379, amqp://host) */
export function pointsAt(value: string, host: string): boolean {
  const h = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|//|@)${h}(:\\d+|/|$)`, 'i').test(value.trim());
}

export function toServiceInfo(s: ComposeService, root: string): ServiceInfo {
  return {
    name: s.name,
    kind: isInfra(s) ? 'infra' : 'app',
    dir: s.dir ? path.relative(root, s.dir).split(path.sep).join('/') || '.' : undefined,
    image: s.image,
    ports: s.ports.length ? s.ports : undefined,
    source: 'docker-compose',
  };
}
