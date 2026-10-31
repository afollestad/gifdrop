// A static server for the repo root that also accepts test reports. Reports
// are saved under tests/e2e/out/ and handed to whoever is waiting for them.
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'tests/e2e/out');

const REPORT_NAME = /^[\w.-]+$/;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.m4a': 'audio/mp4',
    '.mov': 'video/quicktime',
};

function readBody(request) {
    return new Promise((done, fail) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => done(Buffer.concat(chunks)));
        request.on('error', fail);
    });
}

// Safari won't play video from a server without byte ranges.
async function serveFile(request, response, path) {
    const info = await stat(path);
    const type = TYPES[extname(path)] ?? 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        response.writeHead(206, {
            'Content-Type': type,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${info.size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
        });
        createReadStream(path, { start, end }).pipe(response);
        return;
    }
    response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': info.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
    });
    createReadStream(path).pipe(response);
}

// `footagePath` serves one file from anywhere on disk, at /footage.
export async function startServer(port = 0, { footagePath } = {}) {
    const waiters = new Map();
    const arrived = new Map();

    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url, 'http://localhost');
            if (request.method === 'POST' && url.pathname === '/report') {
                const name = url.searchParams.get('name') ?? 'report';
                const ext = url.searchParams.get('ext') ?? 'json';
                if (!REPORT_NAME.test(name) || !REPORT_NAME.test(ext)) {
                    response.writeHead(400).end();
                    return;
                }
                const body = await readBody(request);
                await mkdir(OUT, { recursive: true });
                await writeFile(join(OUT, `${name}.${ext}`), body);
                response.writeHead(204).end();
                if (waiters.has(name)) {
                    waiters.get(name)(body);
                    waiters.delete(name);
                } else {
                    arrived.set(name, body);
                }
                return;
            }
            if (footagePath && url.pathname === '/footage') {
                await serveFile(request, response, footagePath);
                return;
            }
            const pathname = decodeURIComponent(url.pathname);
            const path = normalize(join(ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
            if (!path.startsWith(ROOT + sep)) {
                response.writeHead(403).end();
                return;
            }
            await serveFile(request, response, path);
        } catch (error) {
            if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 500);
            response.end();
        }
    });

    await new Promise((done) => server.listen(port, '127.0.0.1', done));

    return {
        port: server.address().port,
        close: () => {
            server.closeAllConnections();
            server.close();
        },
        waitForReport(name, timeoutMs) {
            if (arrived.has(name)) return Promise.resolve(arrived.get(name));
            return new Promise((done, fail) => {
                const timer = setTimeout(() => fail(new Error(`No report named ${name} within ${timeoutMs}ms`)), timeoutMs);
                waiters.set(name, (body) => {
                    clearTimeout(timer);
                    done(body);
                });
            });
        },
    };
}
