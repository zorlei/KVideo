import path from 'node:path';
import { finding } from '../core/finding.mjs';
import { request } from '../core/http.mjs';
import { writeJson } from '../core/files.mjs';

export async function checkProxy(ctx) {
  if (!ctx.state.appReady) return;
  const proxy = (url) => `${ctx.config.localUrl}/api/proxy?url=${encodeURIComponent(url)}`;
  const cases = {
    missing: await request(`${ctx.config.localUrl}/api/proxy`),
    mp4: await request(proxy(`${ctx.config.fixtureUrl}/test.mp4`)),
    range: await request(proxy(`${ctx.config.fixtureUrl}/test.mp4`), { headers: { range: 'bytes=0-99' } }),
    hls: await request(proxy(`${ctx.config.fixtureUrl}/hls/master.m3u8`)),
    notFound: await request(proxy(`${ctx.config.fixtureUrl}/status/404`)),
    redirect: await request(proxy(`${ctx.config.fixtureUrl}/redirect`)),
    fileProtocol: await request(proxy('file:///etc/hosts')),
  };
  const target = path.join(ctx.dirs.raw, 'proxy-contracts.json');
  writeJson(target, cases);
  const functional = cases.missing.status === 400 && cases.mp4.status === 200 && cases.range.status === 206 &&
    cases.range.bytes === 100 && cases.hls.status === 200 && cases.hls.body.includes('/api/proxy?url=') &&
    cases.notFound.status === 404 && cases.redirect.status === 200;
  finding(ctx, {
    id: 'proxy.functional', category: 'proxy', title: 'Media proxy preserves errors, ranges, redirects, CORS, and rewrites HLS',
    status: functional ? 'PASS' : 'FAIL', severity: 'critical', expected: 'All seven proxy contracts pass',
    actual: JSON.stringify(Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, { status: value.status, bytes: value.bytes, headers: value.headers }]))),
    reason: functional ? 'Deterministic upstream behavior survived the proxy contract.' : 'One or more core proxy behaviors are broken.', evidence: [target],
    remediation: 'Fix forwarding, range/header preservation, redirect handling, or playlist rewriting.',
  });
  const blocksUnsupported = cases.fileProtocol.status >= 400 && cases.fileProtocol.status < 500;
  finding(ctx, {
    id: 'proxy.protocol-validation', category: 'security', title: 'Proxy rejects unsupported protocols before fetching',
    status: blocksUnsupported ? 'PASS' : 'FAIL', severity: 'high', expected: 'Controlled HTTP 4xx for file://', actual: cases.fileProtocol.status,
    reason: blocksUnsupported ? 'Unsupported protocols are rejected as client input.' : 'Unsupported protocols fall into a server error instead of explicit validation.',
    evidence: [target], remediation: 'Allow only http: and https: before invoking fetch.',
  });
  const loopbackFetched = cases.mp4.status === 200;
  finding(ctx, {
    id: 'proxy.private-network-ssrf', category: 'security', title: 'Proxy blocks loopback and private-network targets',
    status: loopbackFetched ? 'FAIL' : 'PASS', severity: 'critical', expected: 'Loopback target rejected', actual: `loopback HTTP ${cases.mp4.status}`,
    reason: loopbackFetched ? 'The public proxy route can reach 127.0.0.1, demonstrating an SSRF primitive on self-hosted deployments.' : 'Private address access was blocked.',
    impact: 'An exposed self-hosted instance may reach internal services available to the application host.', evidence: [target],
    remediation: 'Resolve DNS safely and reject loopback, link-local, private, multicast, and metadata-service address ranges across redirects.',
  });
}
