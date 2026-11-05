import ts from 'typescript';
import type { ExportKind, NodeSecurity } from '../types.js';
import { scanTs } from './security.js';

export interface RawImport {
  specifier: string;
  kind: 'import' | 'reexport' | 'dynamic' | 'type';
  /** named symbols; '*' for namespace / export *, 'default' for default import */
  symbols: string[];
  /** side-effect import (`import './x'`) */
  sideEffect?: boolean;
}

export interface RawExport {
  name: string;
  kind: ExportKind;
  line: number;
}

export interface ParsedFile {
  imports: RawImport[];
  exports: RawExport[];
  loc: number;
  env: string[];
  /** string literals that look like URLs / host references (for v2 service detection) */
  urls: string[];
  security: NodeSecurity;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const URL_HINT = /^[a-z][a-z0-9+.-]*:\/\/|^\/\/|:\d{2,5}(\/|$)/i;

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(c|m)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function countLoc(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) if (line.trim().length) n++;
  return n;
}

/** Parse one file without type-checking: fast enough for thousands of files. */
export function parseFile(fileName: string, text: string): ParsedFile {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const imports: RawImport[] = [];
  const exports: RawExport[] = [];
  const env = new Set<string>();
  const urls = new Set<string>();
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const addExport = (name: string, kind: ExportKind, node: ts.Node) => {
    if (!exports.some((e) => e.name === name)) exports.push({ name, kind, line: line(node) });
  };

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause;
      const symbols: string[] = [];
      if (clause?.name) symbols.push('default');
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) symbols.push('*');
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) symbols.push((el.propertyName ?? el.name).text);
      }
      const allTypes =
        clause?.isTypeOnly ||
        (!!nb && ts.isNamedImports(nb) && !clause?.name && nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly));
      imports.push({
        specifier: st.moduleSpecifier.text,
        kind: allTypes ? 'type' : 'import',
        symbols,
        sideEffect: !clause,
      });
      continue;
    }

    if (ts.isExportDeclaration(st)) {
      if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        const symbols: string[] = [];
        if (!st.exportClause) symbols.push('*');
        else if (ts.isNamespaceExport(st.exportClause)) {
          symbols.push('*');
          addExport(st.exportClause.name.text, 'other', st);
        } else {
          for (const el of st.exportClause.elements) {
            symbols.push((el.propertyName ?? el.name).text);
            addExport(el.name.text, 'other', el);
          }
        }
        imports.push({ specifier: st.moduleSpecifier.text, kind: st.isTypeOnly ? 'type' : 'reexport', symbols });
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) addExport(el.name.text, 'other', el);
      }
      continue;
    }

    if (ts.isExportAssignment(st)) {
      addExport('default', 'default', st);
      continue;
    }

    if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      const expr = st.moduleReference.expression;
      if (ts.isStringLiteral(expr)) imports.push({ specifier: expr.text, kind: 'import', symbols: ['*'] });
      if (hasExportModifier(st)) addExport(st.name.text, 'other', st);
      continue;
    }

    if (!hasExportModifier(st)) continue;
    const isDefault = hasDefaultModifier(st);
    if (ts.isFunctionDeclaration(st)) addExport(isDefault ? 'default' : st.name?.text ?? 'default', 'function', st);
    else if (ts.isClassDeclaration(st)) addExport(isDefault ? 'default' : st.name?.text ?? 'default', 'class', st);
    else if (ts.isInterfaceDeclaration(st)) addExport(st.name.text, 'interface', st);
    else if (ts.isTypeAliasDeclaration(st)) addExport(st.name.text, 'type', st);
    else if (ts.isEnumDeclaration(st)) addExport(st.name.text, 'enum', st);
    else if (ts.isModuleDeclaration(st)) addExport(st.name.getText(sf), 'other', st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          const init = d.initializer;
          const fnLike = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
          addExport(d.name.text, fnLike ? 'function' : 'const', d);
        }
      }
    }
  }

  // Deep walk: require(), import(), CommonJS exports, process.env.X, URL-ish strings.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamic) && arg && ts.isStringLiteralLike(arg)) {
        // top-level `const x = require('y')` counts as a static import
        let p: ts.Node = node.parent;
        while (p && (ts.isVariableDeclaration(p) || ts.isVariableDeclarationList(p) || ts.isPropertyAccessExpression(p) || ts.isObjectBindingPattern(p))) p = p.parent;
        const topLevel = !!p && ts.isVariableStatement(p) && p.parent === sf;
        const already = imports.some((i) => i.specifier === arg.text);
        if (!already) imports.push({ specifier: arg.text, kind: isDynamic || !topLevel ? 'dynamic' : 'import', symbols: ['*'] });
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left)) {
        const obj = left.expression;
        if (ts.isIdentifier(obj) && obj.text === 'module' && left.name.text === 'exports') addExport('default', 'default', node);
        else if (ts.isIdentifier(obj) && obj.text === 'exports') addExport(left.name.text, 'other', node);
        else if (ts.isPropertyAccessExpression(obj) && ts.isIdentifier(obj.expression) && obj.expression.text === 'module' && obj.name.text === 'exports')
          addExport(left.name.text, 'other', node);
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const obj = node.expression;
      if (ts.isPropertyAccessExpression(obj) && obj.name.text === 'env' && ts.isIdentifier(obj.expression) && obj.expression.text === 'process') {
        env.add(node.name.text);
      }
    } else if (ts.isElementAccessExpression(node)) {
      const obj = node.expression;
      if (ts.isPropertyAccessExpression(obj) && obj.name.text === 'env' && ts.isIdentifier(obj.expression) && obj.expression.text === 'process' && ts.isStringLiteralLike(node.argumentExpression)) {
        env.add(node.argumentExpression.text);
      }
    } else if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const t = node.text;
      if (t.length < 300 && URL_HINT.test(t)) urls.add(t);
      // config helpers like loadConfig(['DATABASE_URL']) reference env vars by name
      if (ts.isStringLiteral(node) && ENV_NAME.test(t) && t.includes('_')) env.add(t);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const security = scanTs(sf, imports.map((i) => i.specifier));
  return { imports, exports, loc: countLoc(text), env: [...env], urls: [...urls], security };
}
