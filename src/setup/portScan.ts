import { probeUrl } from './targetProbe.js';

// Common dev-server ports across popular stacks.
//   3000  Next / CRA / Express
//   3001  Next alt / Storybook secondary
//   4321  Astro default
//   5173  Vite default
//   5174  Vite alt (when 5173 is taken)
//   8000  Django / Python / Hugo / Docusaurus
//   8080  Vue CLI / generic Java
export const COMMON_DEV_PORTS = [3000, 3001, 4321, 5173, 5174, 8000, 8080] as const;

export interface ScannedTarget {
  url: string;
  port: number;
  statusCode: number;
  elapsedMs: number;
}

/**
 * Probe a set of ports on `host` in parallel and return the ones that responded.
 * Times out fast (default 800ms per port) so worst-case duration is bounded.
 */
export async function scanLocalPorts(
  host = 'localhost',
  ports: readonly number[] = COMMON_DEV_PORTS,
  timeoutMs = 800,
): Promise<ScannedTarget[]> {
  const probes = ports.map(async (port) => {
    const url = `http://${host}:${port}`;
    const result = await probeUrl(url, timeoutMs);
    if (!result.reachable) return null;
    return {
      url,
      port,
      statusCode: result.statusCode ?? 0,
      elapsedMs: result.elapsedMs ?? 0,
    };
  });
  const all = await Promise.all(probes);
  return all
    .filter((x): x is ScannedTarget => x !== null)
    .sort((a, b) => a.port - b.port);
}
