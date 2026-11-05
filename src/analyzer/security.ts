import ts from 'typescript';
import type { Finding, NodeSecurity } from '../types.js';

/**
 * "Fire safety" survey. Heuristics, not proof: we look for where untrusted input
 * enters a module (sources), dangerous operations (sinks) and secrets, so a human
 * knows where to look first.
 */

export const emptySecurity = (): NodeSecurity => ({ sources: [], sinks: [], secrets: [] });

const SECRET_ENV = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|_KEY$|^DATABASE_URL$|_DSN$|^DSN$)/i;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/, 'AWS access key'],
  [/\bsk_(live|test)_[0-9a-zA-Z]{10,}/, 'Stripe secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{20,}/, 'LLM API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
];
const SECRET_NAME = /(secret|passw(or)?d|api_?key|apikey|access_?token|auth_?token|private_?key|client_?secret)/i;
const PLACEHOLDER = /^(|x+|\*+|changeme|change_me|your[_-].*|<.*>|\$\{.*\}|test|example|dummy|placeholder|todo|null|undefined|none)$/i;

export function envSecret(name: string, line: number): Finding | undefined {
  return SECRET_ENV.test(name) ? { kind: 'env-secret', severity: 'info', line, detail: name } : undefined;
}

/** Hard-coded secret in a string literal? */
export function literalSecret(value: string, line: number, varName?: string): Finding | undefined {
  // long blobs (base64 wasm, fonts, inline data) produce look-alike matches
  if (value.length > 400) return undefined;
  for (const [re, label] of SECRET_PATTERNS) if (re.test(value)) return { kind: 'hardcoded-secret', severity: 'high', line, detail: label };
  if (varName && SECRET_NAME.test(varName) && value.length >= 8 && !PLACEHOLDER.test(value) && !/\s/.test(value)) {
    return { kind: 'hardcoded-secret', severity: 'high', line, detail: `${varName} = "${value.slice(0, 4)}…"` };
  }
  return undefined;
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'del', 'all', 'options', 'head', 'route']);
const DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Options', 'Head']);
const REQ_INPUT = /^(req|request|ctx\.request|ctx|c\.req|event|context\.req)\.(body|query|params|headers|cookies|files|file|form|formData|searchParams)$/;
const REQ_CALL = /^(req|request|c\.req|ctx\.req)\.(json|text|formData|param|query|parseBody)$/;
const SQL_WORDS = /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b|\b(create|drop|alter|truncate)\s+table\b/i;
const SQL_METHODS = new Set(['query', 'raw', 'execute', 'unsafe', '$queryRawUnsafe', '$executeRawUnsafe', 'queryRawUnsafe', 'executeRawUnsafe', 'whereRaw', 'joinRaw', 'orderByRaw']);
const EXEC_METHODS = new Set(['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']);
const FETCH_CALLEES = /^(fetch|axios(\.(get|post|put|patch|delete|request))?|got|request|needle|superagent\.(get|post)|https?\.(get|request))$/;
const FS_METHODS = new Set(['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'createReadStream', 'createWriteStream', 'unlink', 'unlinkSync', 'sendFile', 'rm', 'rmSync', 'appendFile']);
const USER_INPUT_TEXT = /\b(req|request|params|query|body|ctx\.request|event\.body|input|userInput)\b/;

/** a string built at runtime: `select ${x}` or 'a' + b */
function isDynamicString(node: ts.Expression): boolean {
  if (ts.isTemplateExpression(node)) return node.templateSpans.length > 0;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const lit = (n: ts.Expression) => ts.isStringLiteralLike(n) || ts.isNumericLiteral(n);
    return !(lit(node.left) && lit(node.right));
  }
  return ts.isIdentifier(node) || ts.isCallExpression(node) || ts.isPropertyAccessExpression(node);
}

function calleeText(e: ts.Expression, sf: ts.SourceFile): string {
  const t = e.getText(sf);
  return t.length > 80 ? t.slice(0, 80) : t.replace(/\s+/g, '');
}

export function scanTs(sf: ts.SourceFile, importSpecifiers: string[]): NodeSecurity {
  const out = emptySecurity();
  const usesChildProcess = importSpecifiers.some((s) => s === 'child_process' || s === 'node:child_process' || s === 'execa' || s === 'shelljs');
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const seenInput = new Set<string>();
  const add = (list: Finding[], f: Finding) => {
    if (list.length < 40 && !list.some((x) => x.kind === f.kind && x.line === f.line)) list.push(f);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
      const full = calleeText(callee, sf);
      const [arg0] = node.arguments;

      // sources: app.get('/users/:id', …), router.post('/x', …)
      if (ts.isPropertyAccessExpression(callee) && VERBS.has(name) && arg0 && ts.isStringLiteralLike(arg0) && arg0.text.startsWith('/')) {
        add(out.sources, { kind: 'http-route', severity: 'info', line: line(node), detail: `${name.toUpperCase()} ${arg0.text}` });
      }
      if (REQ_CALL.test(full) && !seenInput.has(full)) {
        seenInput.add(full);
        add(out.sources, { kind: 'request-input', severity: 'info', line: line(node), detail: `${full}()` });
      }

      // sinks
      if (SQL_METHODS.has(name) && arg0 && isDynamicString(arg0) && !ts.isIdentifier(arg0) && SQL_WORDS.test(arg0.getText(sf))) {
        add(out.sinks, { kind: 'sql-injection', severity: 'medium', line: line(node), detail: `${full}(\`…\${…}\`) builds SQL from a dynamic string` });
      }
      if (usesChildProcess && EXEC_METHODS.has(name) && arg0) {
        const dyn = isDynamicString(arg0);
        add(out.sinks, { kind: 'command-exec', severity: dyn ? 'high' : 'low', line: line(node), detail: `${full}(${dyn ? 'dynamic command' : 'fixed command'})` });
      }
      if ((ts.isIdentifier(callee) && callee.text === 'eval') || /^vm\.runIn(New|This)?Context$|^vm\.compileFunction$/.test(full)) {
        add(out.sinks, { kind: 'code-eval', severity: 'high', line: line(node), detail: `${full}()` });
      }
      if (FETCH_CALLEES.test(full) && arg0 && isDynamicString(arg0) && USER_INPUT_TEXT.test(arg0.getText(sf))) {
        add(out.sinks, { kind: 'ssrf', severity: 'medium', line: line(node), detail: `${full}() with a URL built from request data` });
      }
      if (FS_METHODS.has(name) && arg0 && USER_INPUT_TEXT.test(arg0.getText(sf))) {
        add(out.sinks, { kind: 'path-traversal', severity: 'medium', line: line(node), detail: `${full}() with a path from request data` });
      }
      if (name === 'redirect' && arg0 && USER_INPUT_TEXT.test(arg0.getText(sf))) {
        add(out.sinks, { kind: 'open-redirect', severity: 'low', line: line(node), detail: `${full}() to a URL from request data` });
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      add(out.sinks, { kind: 'code-eval', severity: 'high', line: line(node), detail: 'new Function()' });
    } else if (ts.isDecorator(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && DECORATORS.has(node.expression.expression.text)) {
      const a = node.expression.arguments[0];
      add(out.sources, { kind: 'http-route', severity: 'info', line: line(node), detail: `@${node.expression.expression.text}(${a && ts.isStringLiteralLike(a) ? `'${a.text}'` : ''})` });
    } else if (ts.isPropertyAccessExpression(node)) {
      const t = calleeText(node, sf);
      if (REQ_INPUT.test(t) && !seenInput.has(t) && !(ts.isPropertyAccessExpression(node.parent) && REQ_INPUT.test(calleeText(node.parent, sf)))) {
        seenInput.add(t);
        add(out.sources, { kind: 'request-input', severity: 'info', line: line(node), detail: t });
      }
      const obj = node.expression;
      if (ts.isPropertyAccessExpression(obj) && obj.name.text === 'env' && ts.isIdentifier(obj.expression) && obj.expression.text === 'process') {
        const f = envSecret(node.name.text, line(node));
        if (f) add(out.secrets, f);
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && /^(innerHTML|outerHTML)$/.test(node.left.name.text) && isDynamicString(node.right)) {
      add(out.sinks, { kind: 'xss', severity: 'medium', line: line(node), detail: `.${node.left.name.text} = dynamic value` });
    } else if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'dangerouslySetInnerHTML') {
      add(out.sinks, { kind: 'xss', severity: 'medium', line: line(node), detail: 'dangerouslySetInnerHTML' });
    } else if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) {
      const init = node.initializer;
      if (init && ts.isStringLiteralLike(init)) {
        const nm = node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;
        const f = literalSecret(init.text, line(init), nm);
        if (f) add(out.secrets, f);
      }
    } else if (ts.isStringLiteralLike(node) && node.text.length >= 16) {
      const f = literalSecret(node.text, line(node));
      if (f) add(out.secrets, f);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export const hasSecurity = (s?: NodeSecurity) => !!s && s.sources.length + s.sinks.length + s.secrets.length > 0;
