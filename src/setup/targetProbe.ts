import { request as undiciRequest } from 'undici';

export interface ProbeResult {
  url: string;
  reachable: boolean;
  statusCode?: number;
  elapsedMs?: number;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 4000;

export async function probeUrl(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await undiciRequest(url, {
      method: 'HEAD',
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });
    const elapsedMs = Date.now() - start;
    // Treat 4xx as "reachable" (the server is up; auth/route is the user's
    // problem). 5xx is still reachable but warning-worthy.
    return {
      url,
      reachable: res.statusCode >= 200 && res.statusCode < 500,
      statusCode: res.statusCode,
      elapsedMs,
    };
  } catch (err) {
    return {
      url,
      reachable: false,
      reason: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  }
}
