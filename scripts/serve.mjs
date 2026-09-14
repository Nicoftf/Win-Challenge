// ============================================================
//  scripts/serve.mjs – kleiner Webserver für die lokale Entwicklung
// ============================================================
//  Ohne Abhängigkeiten, läuft unter Windows, macOS und Linux.
//    node scripts/serve.mjs          → http://localhost:8000/
//    node scripts/serve.mjs 8791     → anderer Port
//  Schickt "Cache-Control: no-store", damit Änderungen sofort sichtbar sind.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Windows/macOS ignorieren Groß-/Kleinschreibung in Dateinamen, GitHub Pages nicht.
 * Damit ein falsch geschriebener Pfad schon lokal als 404 auffällt, die echte Schreibweise vergleichen.
 */
const ROOT_REAL = (() => { try { return realpathSync.native(ROOT); } catch { return ROOT; } })();
function exactCase(file) {
  if (process.platform === 'linux') return true;
  try {
    return relative(ROOT_REAL, realpathSync.native(file)) === relative(ROOT, file);
  } catch {
    return false;
  }
}

/** Startet den Server. Port 0 = freien Port wählen. Gibt { server, port, url } zurück. */
export function startServer(port = 8000, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(ROOT, '.' + pathname);
      if (file !== ROOT && !file.startsWith(ROOT + sep)) {
        res.writeHead(403).end('403');
        return;
      }
      let info = await stat(file).catch(() => null);
      if (info && info.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info || !exactCase(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 – nicht gefunden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e));
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const p = server.address().port;
      ok({ server, port: p, url: `http://localhost:${p}/` });
    });
  });
}

// Direkt gestartet (node scripts/serve.mjs) oder nur importiert (Tests)?
// Unter Windows können Laufwerksbuchstabe und Groß-/Kleinschreibung abweichen, daher normalisieren.
const normPath = (p) => {
  try { p = realpathSync(p); } catch { /* Datei fehlt – Pfad so lassen */ }
  return process.platform === 'win32' ? p.toLowerCase() : p;
};
const isMain = !!process.argv[1] && normPath(resolve(process.argv[1])) === normPath(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(process.argv[2] || process.env.PORT || 8000);
  startServer(port)
    .then(({ url }) => console.log(`Win-Challenge läuft auf ${url}  (Strg+C beendet)`))
    .catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} ist schon belegt. Anderen Port angeben: node scripts/serve.mjs 8001` : e);
      process.exit(1);
    });
}
