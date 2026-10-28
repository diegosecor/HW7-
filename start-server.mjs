import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".wasm": "application/wasm", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".task": "application/octet-stream" };

export function createGameServer() {
  return createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
      const filePath = resolve(root, "." + (urlPath === "/" ? "/index.html" : urlPath));
      const localPath = relative(root, filePath);
      if (localPath.startsWith("..") || isAbsolute(localPath) || localPath.split(/[/\\]/).some(part => part.startsWith("."))) {
        response.writeHead(403); response.end("Forbidden"); return;
      }
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("Not a file");
      const headers = { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
      let start = 0, end = info.size - 1, status = 200;
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        } else start = -1;
        if (start < 0 || start >= info.size || start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
          response.writeHead(416, { "Content-Range": `bytes */${info.size}` }); response.end(); return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      }
      headers["Content-Length"] = info.size ? end - start + 1 : 0;
      response.writeHead(status, headers);
      if (request.method === "HEAD" || !info.size) { response.end(); return; }
      const stream = createReadStream(filePath, { start, end });
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createGameServer().listen(4173, "127.0.0.1", () => {
    console.log("Orchestra Panic is running at http://127.0.0.1:4173 — keep this terminal open.");
  }).on("error", error => {
    console.error(error.code === "EADDRINUSE" ? "The game is already running. Open http://127.0.0.1:4173" : error.message);
    process.exitCode = 1;
  });
}
