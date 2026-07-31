import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../core/command.mjs';
import { finding } from '../core/finding.mjs';
import { readJson } from '../core/files.mjs';

function major(version) {
  return Number(String(version).replace(/^v/, '').split('.')[0]);
}

export async function checkPreflight(ctx) {
  const pkg = readJson(path.join(ctx.config.root, 'package.json'));
  const release = readJson(path.join(ctx.config.root, 'app-release.json'));
  const versionsMatch = pkg.version === release.currentVersion && pkg.version === release.releases?.[0]?.version;
  finding(ctx, {
    id: 'preflight.version-consistency', category: 'preflight', title: 'Local version metadata agrees',
    status: versionsMatch ? 'PASS' : 'FAIL', severity: 'high', expected: 'package.json, currentVersion, and first release match',
    actual: JSON.stringify({ package: pkg.version, current: release.currentVersion, release: release.releases?.[0]?.version }),
    reason: versionsMatch ? 'All local release sources agree.' : 'Release sources disagree and can publish ambiguous artifacts.',
    remediation: 'Update all version sources atomically before release.',
  });
  const nodeMajor = major(process.version);
  finding(ctx, {
    id: 'preflight.node', category: 'preflight', title: 'Node.js runtime is supported',
    status: nodeMajor >= 20 && nodeMajor <= 26 ? 'PASS' : 'WARN', severity: 'medium', expected: 'Node.js 20 through 26',
    actual: process.version, reason: nodeMajor >= 20 && nodeMajor <= 26 ? 'Runtime is within the tested range.' : 'Runtime is outside the declared range.',
    remediation: 'Use an LTS version supported by Next.js and the repository.',
  });
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  finding(ctx, {
    id: 'preflight.chrome', category: 'preflight', title: 'Chrome executable is available',
    status: fs.existsSync(chrome) ? 'PASS' : 'FAIL', severity: 'high', expected: chrome, actual: fs.existsSync(chrome),
    reason: fs.existsSync(chrome) ? 'UI checks can launch an isolated browser.' : 'UI checks cannot launch the required browser.',
    remediation: 'Install Google Chrome or configure a supported executable.',
  });
  ctx.state.chromePath = chrome;
  const git = await runCommand(ctx, 'git-status', 'git', ['status', '--porcelain=v1'], { timeoutMs: 30_000 });
  const businessChanges = git.tail.split('\n').filter(Boolean).filter((line) => !line.slice(3).startsWith('verification/'));
  finding(ctx, {
    id: 'preflight.business-tree', category: 'preflight', title: 'Business source tree has no unrelated edits',
    status: businessChanges.length ? 'FAIL' : 'PASS', severity: 'high', expected: 'No changes outside verification/',
    actual: businessChanges.length ? businessChanges.join('\n') : 'clean',
    reason: businessChanges.length ? 'Unrelated edits make attribution and safe publishing ambiguous.' : 'Only the validation scope is changed.',
    evidence: [git.outputPath], remediation: 'Separate or explicitly approve unrelated changes before publishing.',
  });
}
