const secretKey = /(password|passwd|token|secret|authorization|cookie|api[-_]?key)/i;
const bearer = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const githubToken = /\b(gh[opusr]_[A-Za-z0-9_]{20,})\b/g;
const jwt = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function redactText(value) {
  return String(value)
    .replace(bearer, '$1[REDACTED]')
    .replace(githubToken, '[REDACTED_GITHUB_TOKEN]')
    .replace(jwt, '[REDACTED_JWT]')
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
}

export function redact(value, key = '') {
  if (secretKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]),
  );
}
