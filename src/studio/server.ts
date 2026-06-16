import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runAdHocSynthesis } from './synthesize.js';
import { logger, onEvent } from '../util/logger.js';
import type { LLMConfig } from '../config/schema.js';

export interface StudioServerOptions {
  runsRoot: string;
  staticDir: string;
  /** Optional LLM provider config threaded into ad-hoc synthesis (see AdHocOptions.llm). */
  llm?: LLMConfig;
}

function json(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(
  res: http.ServerResponse,
  filePath: string,
  contentType: string,
  notFoundMessage?: string,
): void {
  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      json(res, 404, { error: notFoundMessage ?? 'not found' });
      return;
    }
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': stats.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

export function createStudioServer({ runsRoot, staticDir, llm }: StudioServerOptions): http.Server {
  const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost`);
      const pathname = url.pathname;

      // GET /api/health
      if (req.method === 'GET' && pathname === '/api/health') {
        json(res, 200, { ok: true });
        return;
      }

      // POST /api/synthesize
      if (req.method === 'POST' && pathname === '/api/synthesize') {
        if (!process.env['ELEVENLABS_API_KEY']) {
          json(res, 400, { error: 'ELEVENLABS_API_KEY not set' });
          return;
        }
        readBody(req)
          .then((raw) => {
            let body: Record<string, unknown>;
            try {
              body = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              json(res, 400, { error: 'invalid JSON body' });
              return;
            }
            return runAdHocSynthesis(
              body as unknown as Parameters<typeof runAdHocSynthesis>[0],
              { runsRoot, ...(llm ? { llm } : {}) },
            ).then(({ summary, workdir }) => {
              const hash = path.basename(workdir);
              json(res, 200, { summary, audioUrl: `/api/audio?run=${hash}` });
            });
          })
          .catch((err: unknown) => {
            logger.error('synthesize error', { err: String(err) });
            json(res, 500, { error: 'synthesis failed', detail: String(err) });
          });
        return;
      }

      // GET /api/audio?run=<hash>
      if (req.method === 'GET' && pathname === '/api/audio') {
        const hash = url.searchParams.get('run') ?? '';
        if (!hash) {
          json(res, 400, { error: 'missing run param' });
          return;
        }
        // Safe: hash is a 16-char hex string from SHA-256; no path traversal possible,
        // but normalise anyway.
        const audioPath = path.resolve(runsRoot, hash, 'segments', 'audio', '_master.raw.mp3');
        if (!audioPath.startsWith(path.resolve(runsRoot))) {
          json(res, 400, { error: 'invalid run' });
          return;
        }
        serveFile(res, audioPath, 'audio/mpeg', 'audio not found');
        return;
      }

      // GET /api/progress — SSE
      if (req.method === 'GET' && pathname === '/api/progress') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.flushHeaders();

        const unsub = onEvent((e) => {
          const line = `data: ${JSON.stringify(e)}\n\n`;
          res.write(line);
        });

        req.on('close', unsub);
        return;
      }

      // Static file serving — only for GET / HEAD
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'method not allowed' });
        return;
      }

      // Safe path resolution (guard against .. traversal)
      const resolvedStatic = path.resolve(staticDir);
      // Strip leading slash and normalise
      const relPath = pathname.replace(/^\/+/, '') || 'index.html';
      const candidate = path.resolve(resolvedStatic, relPath);

      if (!candidate.startsWith(resolvedStatic)) {
        json(res, 400, { error: 'bad path' });
        return;
      }

      fs.stat(candidate, (statErr, stats) => {
        if (!statErr && stats.isFile()) {
          // Guess a minimal content-type from extension
          const ext = path.extname(candidate).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.mjs': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
          };
          const mime = mimeMap[ext] ?? 'application/octet-stream';
          res.writeHead(200, {
            'content-type': mime,
            'content-length': stats.size,
          });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            fs.createReadStream(candidate).pipe(res);
          }
        } else {
          // SPA fallback: serve index.html
          const indexPath = path.resolve(resolvedStatic, 'index.html');
          if (!indexPath.startsWith(resolvedStatic)) {
            json(res, 500, { error: 'internal error' });
            return;
          }
          fs.stat(indexPath, (idxErr, idxStats) => {
            if (idxErr || !idxStats.isFile()) {
              json(res, 404, { error: 'not found' });
              return;
            }
            res.writeHead(200, {
              'content-type': 'text/html',
              'content-length': idxStats.size,
            });
            if (req.method === 'HEAD') {
              res.end();
            } else {
              fs.createReadStream(indexPath).pipe(res);
            }
          });
        }
      });
    },
  );

  return server;
}
