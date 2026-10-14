// Provider errors may embed credentials in messages, stacks, URLs and metadata.
// Only known identifiers are emitted; never serialize the original exception.
const names = new Set(['Error', 'TypeError', 'AggregateError', 'AbortError',
  'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientInitializationError',
  'DriverAdapterError', 'ConnectionTimeoutError', 'SocketClosedUnexpectedlyError',
  'ClientClosedError', 'ClientOfflineError', 'SimpleError', 'ReplyError']);
const codes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01', '28P01', '28000',
  '3D000', '42501', '53300', '53400', '57014', '57P01', '57P02', '57P03',
  'P1000', 'P1001', 'P1002', 'P1003', 'P1010', 'P1011', 'P1017', 'P2010', 'P2024', 'P2037',
  'NOAUTH', 'WRONGPASS', 'NOPERM', 'READONLY', 'LOADING', 'BUSY', 'ERR',
  'HEALTH_TIMEOUT', 'REDIS_NOT_READY', 'REDIS_UNEXPECTED_RESPONSE']);

export function dependencyErrorDetails(error: unknown) {
  const root = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
  const errorName = typeof root?.name === 'string' && names.has(root.name) ? root.name : 'UnknownError';
  const found = new Set<string>(), seen = new Set<object>();
  function inspect(value: unknown, depth = 0): void {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ['code', 'originalCode']) {
      const code = record[key];
      if (typeof code === 'string' && codes.has(code)) found.add(code);
    }
    // Redis RESP errors sometimes expose the identifier only as a message prefix.
    const prefix = typeof record.message === 'string' ? /^(NOAUTH|WRONGPASS|NOPERM|READONLY|LOADING|BUSY|ERR)(?:\s|$)/.exec(record.message)?.[1] : undefined;
    if (prefix) found.add(prefix);
    for (const key of ['cause', 'meta', 'driverAdapterError']) inspect(record[key], depth + 1);
    if (Array.isArray(record.errors)) for (const child of record.errors.slice(0, 8)) inspect(child, depth + 1);
  }
  inspect(error);
  return { errorName, codes: [...found] };
}

export function logDependencyFailure(event: 'dependency_probe_failed' | 'database_pool_error' | 'database_connection_error' | 'redis_unavailable' | 'redis_connect_failed', dependency: 'database' | 'redis', error: unknown) {
  console.error(JSON.stringify({ event, dependency, ...dependencyErrorDetails(error) }));
}
