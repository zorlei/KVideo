import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../core/command.mjs';
import { finding } from '../core/finding.mjs';

export async function checkHarnessSelf(ctx) {
  const testDir = path.join(ctx.config.verifyDir, 'tests');
  const tests = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join(testDir, name));
  const result = await runCommand(ctx, 'verification-self-tests', 'node', ['--test', ...tests], { cwd: ctx.config.root, timeoutMs: 60_000 });
  finding(ctx, {
    id: 'harness.self-tests', category: 'harness', title: 'Verification framework self-tests pass',
    status: result.code === 0 ? 'PASS' : 'FAIL', severity: 'critical', expected: 'node --test exit 0', actual: `exit ${result.code}`,
    reason: result.code === 0 ? 'Core redaction, HTTP parsing, graph helpers, and report escaping are verified.' : 'The validation framework failed its own tests.',
    evidence: [result.outputPath], remediation: 'Fix the harness before treating any project result as authoritative.', durationMs: result.durationMs,
  });
}
