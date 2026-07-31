import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { jsonBody, request } from '../src/core/http.mjs';

test('HTTP evidence captures status, headers, body, and timing', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(201, { 'content-type': 'application/json', 'x-test': 'yes' });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const result = await request(`http://127.0.0.1:${address.port}`);
  assert.equal(result.status, 201);
  assert.equal(result.headers['x-test'], 'yes');
  assert.deepEqual(jsonBody(result), { ok: true });
  await new Promise((resolve) => server.close(resolve));
});
