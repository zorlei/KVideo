export async function request(url, options = {}) {
  const started = performance.now();
  const { timeoutMs = 20_000, ...fetchOptions } = options;
  try {
    const response = await fetch(url, {
      redirect: fetchOptions.redirect || 'follow',
      ...fetchOptions,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: true,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      headers: Object.fromEntries(response.headers),
      bytes: buffer.length,
      body: buffer.toString('utf8', 0, Math.min(buffer.length, 100_000)),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
      headers: {}, bytes: 0, body: '',
    };
  }
}

export function jsonBody(result) {
  try { return JSON.parse(result.body); } catch { return null; }
}
