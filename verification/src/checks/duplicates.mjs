import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../core/command.mjs';
import { finding } from '../core/finding.mjs';

function findReport(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).map((name) => path.join(dir, name)).find((file) => file.endsWith('.json')) || null;
}

export async function checkDuplicates(ctx) {
  const output = path.join(ctx.dirs.metrics, 'jscpd');
  const bin = path.join(ctx.config.verifyDir, 'node_modules', '.bin', 'jscpd');
  const args = ['--min-lines', '8', '--min-tokens', '60', '--reporters', 'json', '--output', output, 'app', 'components', 'lib'];
  const result = await runCommand(ctx, 'jscpd', bin, args, { cwd: ctx.config.root });
  const report = findReport(output);
  let data = null;
  try { data = report ? JSON.parse(fs.readFileSync(report, 'utf8')) : null; } catch { /* report parse failure */ }
  const percentage = data?.statistics?.total?.percentage ?? data?.statistics?.total?.percentageTokens ?? null;
  const clones = data?.duplicates?.length ?? null;
  const ok = result.code === 0 && data && Number(percentage || 0) <= 5;
  finding(ctx, {
    id: 'quality.duplication', category: 'quality', title: 'Copy-paste duplication stays below threshold',
    status: ok ? 'PASS' : 'FAIL', severity: 'medium', expected: 'jscpd completes and duplicated lines <= 5%',
    actual: data ? `${percentage}% duplication; ${clones ?? 'unknown'} clone groups` : `jscpd exit ${result.code}; no report`,
    reason: ok ? 'Token-based clone analysis is below the configured limit.' : 'High duplication or a failed clone scan hides inconsistent parallel implementations.',
    evidence: [result.outputPath, ...(report ? [report] : [])], remediation: 'Extract shared domain logic and remove copied branches with divergent behavior.',
    durationMs: result.durationMs,
  });
}
