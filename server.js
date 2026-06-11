const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'on-thi-tn.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS app_records (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`);

const selectRecord = db.prepare('SELECT value FROM app_records WHERE key = ?');
const upsertRecord = db.prepare(`
INSERT INTO app_records (key, value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const deleteRecord = db.prepare('DELETE FROM app_records WHERE key = ?');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 25 * 1024 * 1024) {
                reject(new Error('Payload quá lớn'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function safeRecordKey(urlPath) {
    const key = decodeURIComponent(urlPath.replace(/^\/api\/records\//, ''));
    return /^[a-zA-Z0-9_-]+$/.test(key) ? key : '';
}

async function handleApi(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (req.url === '/api/health') {
        return send(res, 200, JSON.stringify({ ok: true }));
    }

    if (req.url.startsWith('/api/records/')) {
        const key = safeRecordKey(req.url.split('?')[0]);
        if (!key) return send(res, 400, JSON.stringify({ error: 'Key không hợp lệ' }));

        if (req.method === 'GET') {
            const row = selectRecord.get(key);
            return send(res, 200, JSON.stringify({ value: row ? JSON.parse(row.value) : null }));
        }

        if (req.method === 'POST') {
            try {
                const raw = await readBody(req);
                const parsed = JSON.parse(raw || '{}');
                upsertRecord.run(key, JSON.stringify(parsed.value ?? null), Date.now());
                return send(res, 200, JSON.stringify({ ok: true }));
            } catch (err) {
                return send(res, 400, JSON.stringify({ error: err.message }));
            }
        }

        if (req.method === 'DELETE') {
            deleteRecord.run(key);
            return send(res, 200, JSON.stringify({ ok: true }));
        }
    }

    send(res, 404, JSON.stringify({ error: 'Không tìm thấy API' }));
}

function serveStatic(req, res) {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const requested = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = path.normalize(path.join(ROOT, requested));

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (['.sqlite', '.db', '.sqlite3'].includes(path.extname(filePath).toLowerCase())) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Không được truy cập file database');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Không tìm thấy file');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
        handleApi(req, res).catch(err => send(res, 500, JSON.stringify({ error: err.message })));
        return;
    }
    serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Ôn Thi TN server: http://localhost:${PORT}`);
    console.log(`SQLite database: ${DB_PATH}`);
});
