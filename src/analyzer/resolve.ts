import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export interface WorkspacePackage {
  name: string;
  /** absolute dir */
  dir: string;
  pkg: Record<string, any>;
}

const SOURCE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Resolves import specifiers to absolute file paths inside the project. */
export class Resolver {
  private optionsCache = new Map<string, ts.CompilerOptions>();
  private resolutionCaches = new Map<ts.CompilerOptions, ts.ModuleResolutionCache>();
  private host: ts.ModuleResolutionHost = {
    fileExists: (f) => ts.sys.fileExists(f),
    readFile: (f) => ts.sys.readFile(f),
    directoryExists: (d) => ts.sys.directoryExists?.(d) ?? fs.existsSync(d),
    realpath: (p) => p,
    getCurrentDirectory: () => this.root,
  };

  constructor(
    private root: string,
    private fileSet: Set<string>,
    private workspaces: WorkspacePackage[],
  ) {}

  /** nearest tsconfig/jsconfig options for a directory (walks up to the root) */
  private optionsFor(dir: string): ts.CompilerOptions {
    const cached = this.optionsCache.get(dir);
    if (cached) return cached;
    let opts: ts.CompilerOptions | undefined;
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const cfg = path.join(dir, name);
      if (fs.existsSync(cfg)) {
        const read = ts.readConfigFile(cfg, ts.sys.readFile);
        if (!read.error) {
          const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir, undefined, cfg);
          opts = parsed.options;
        }
        break;
      }
    }
    if (!opts) {
      const parent = path.dirname(dir);
      opts = dir === this.root || parent === dir || !dir.startsWith(this.root) ? {} : this.optionsFor(parent);
    }
    const final: ts.CompilerOptions = {
      ...opts,
      allowJs: true,
      resolveJsonModule: false,
      noEmit: true,
    };
    const mr = final.moduleResolution;
    if (mr === undefined || mr === ts.ModuleResolutionKind.Classic) final.moduleResolution = ts.ModuleResolutionKind.Bundler;
    if (final.moduleResolution === ts.ModuleResolutionKind.Bundler) final.module = ts.ModuleKind.ESNext;
    this.optionsCache.set(dir, final);
    return final;
  }

  private cacheFor(opts: ts.CompilerOptions) {
    let c = this.resolutionCaches.get(opts);
    if (!c) {
      c = ts.createModuleResolutionCache(this.root, (s) => s, opts);
      this.resolutionCaches.set(opts, c);
    }
    return c;
  }

  /**
   * @returns absolute path of an internal file, `{ external: pkgName }`, or null for assets / unknowns.
   */
  resolve(specifier: string, fromFile: string): string | { external: string } | null {
    if (/\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|json|md|html|txt|wasm|woff2?)(\?.*)?$/i.test(specifier)) return null;
    if (specifier.startsWith('node:')) return { external: specifier };

    const ws = this.resolveWorkspace(specifier);
    if (ws) return ws;

    const opts = this.optionsFor(path.dirname(fromFile));
    const res = ts.resolveModuleName(specifier, fromFile, opts, this.host, this.cacheFor(opts));
    const resolved = res.resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport) {
      const file = path.normalize(resolved.resolvedFileName);
      if (this.fileSet.has(file)) return file;
      // resolved to a .d.ts next to a .js, or outside the scan: try sibling sources
      const sib = this.trySources(file.replace(/\.d\.ts$|\.[^./]+$/, ''));
      if (sib) return sib;
    }
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.(js|mjs|cjs|jsx)$/, ''));
      return this.trySources(base) ?? null;
    }
    return { external: packageName(specifier) };
  }

  private trySources(base: string): string | undefined {
    for (const ext of SOURCE_EXT) if (this.fileSet.has(base + ext)) return base + ext;
    for (const ext of SOURCE_EXT) if (this.fileSet.has(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext);
    return undefined;
  }

  /** monorepo packages: map `@acme/utils` and `@acme/utils/sub` to their source files */
  private resolveWorkspace(specifier: string): string | undefined {
    for (const ws of this.workspaces) {
      if (specifier !== ws.name && !specifier.startsWith(ws.name + '/')) continue;
      const sub = specifier.slice(ws.name.length + 1);
      if (sub) {
        return (
          this.trySources(path.join(ws.dir, 'src', sub)) ??
          this.trySources(path.join(ws.dir, sub)) ??
          this.trySources(path.join(ws.dir, sub.replace(/^(dist|lib|build)\//, 'src/')))
        );
      }
      const p = ws.pkg;
      const candidates: string[] = [];
      for (const field of [p.source, p.types, p.typings, p.module, p.main, typeof p.exports === 'string' ? p.exports : p.exports?.['.']?.import ?? p.exports?.['.']?.default ?? p.exports?.['.']]) {
        if (typeof field === 'string') {
          const noExt = field.replace(/\.d\.ts$|\.[^./]+$/, '');
          candidates.push(noExt, noExt.replace(/^\.?\/?(dist|lib|build|out)\//, 'src/'));
        }
      }
      candidates.push('src/index', 'index', 'src/main', 'lib/index');
      for (const c of candidates) {
        const hit = this.trySources(path.join(ws.dir, c));
        if (hit) return hit;
      }
    }
    return undefined;
  }
}

export function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
