import fs from 'node:fs';
import path from 'node:path';
import { finding } from '../core/finding.mjs';
import { relative, walk, writeJson } from '../core/files.mjs';

const textExt = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.yml', '.yaml', '.toml', '.md']);
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['generic-secret-assignment', /(?:secret|token|password|api[_-]?key)\s*[:=]\s*['"][^'"\n]{12,}['"]/i],
];

export async function checkSecurityScan(ctx) {
  const files = walk(ctx.config.root, (file) => textExt.has(path.extname(file)) && !file.includes('/verification/artifacts/'));
  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [name, pattern] of patterns) if (pattern.test(line)) hits.push({ file: relative(ctx.config.root, file), line: index + 1, pattern: name });
    });
  }
  const target = path.join(ctx.dirs.metrics, 'secret-scan.json');
  writeJson(target, hits);
  finding(ctx, {
    id: 'security.static-secrets', category: 'security', title: 'Repository contains no obvious committed secrets',
    status: hits.length ? 'FAIL' : 'PASS', severity: 'critical', expected: '0 credential-pattern matches',
    actual: hits.length ? JSON.stringify(hits) : '0',
    reason: hits.length ? 'Credential-like material appears in repository text. Values are intentionally omitted from logs.' : 'No configured credential signature was found.',
    evidence: [target], remediation: 'Remove and rotate confirmed credentials; replace false positives with safe fixtures.',
  });
  const dangerous = files.filter((file) => ['.ts', '.tsx', '.js', '.mjs'].includes(path.extname(file))).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [
      ...(text.includes('dangerouslySetInnerHTML') ? [{ file: relative(ctx.config.root, file), construct: 'dangerouslySetInnerHTML' }] : []),
      ...(text.match(/\beval\s*\(/) ? [{ file: relative(ctx.config.root, file), construct: 'eval' }] : []),
    ];
  });
  finding(ctx, {
    id: 'security.dangerous-constructs', category: 'security', title: 'Dangerous runtime constructs are inventoried',
    status: dangerous.length ? 'WARN' : 'PASS', severity: 'medium', expected: 'No eval or unreviewed raw HTML injection', actual: JSON.stringify(dangerous),
    reason: dangerous.length ? 'These constructs expand injection risk and require contextual review.' : 'No configured dangerous construct was found.',
    remediation: 'Verify sanitization and replace raw execution or HTML injection where possible.',
  });
}
