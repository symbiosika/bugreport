import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * fetch()-compatible shim that shells out to curl.
 *
 * Only needed in environments where Bun's fetch cannot pass the local
 * TLS-intercepting proxy (e.g. sandboxed CI). Enable it for the example
 * server with BUGREPORT_CURL_FETCH=1. Production deployments use the normal
 * global fetch — the LLM adapter merely accepts a custom implementation,
 * which is also handy for corporate proxies or request logging.
 */
export const curlFetch = (async (
  input: URL | RequestInfo,
  init?: RequestInit,
): Promise<Response> => {
  const req = new Request(input, init);
  const dir = await mkdtemp(join(tmpdir(), "curlfetch-"));
  const bodyFile = join(dir, "req.bin");
  const outFile = join(dir, "res.bin");
  const headerFile = join(dir, "res.headers");

  try {
    const args = [
      "-sS",
      "--http1.1",
      "--max-time",
      "180",
      "-X",
      req.method,
      "-o",
      outFile,
      "-D",
      headerFile,
      "-w",
      "%{http_code}",
    ];
    req.headers.forEach((value, name) => {
      if (name === "content-length") return; // curl sets it
      args.push("-H", `${name}: ${value}`);
    });
    if (req.method !== "GET" && req.method !== "HEAD") {
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > 0) {
        await writeFile(bodyFile, body);
        args.push("--data-binary", `@${bodyFile}`);
      }
    }
    args.push(req.url);

    const proc = Bun.spawn(["curl", ...args], { stderr: "pipe" });
    const [status, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if ((await proc.exited) !== 0) {
      throw new Error(`curl failed: ${stderr.trim()}`);
    }

    const rawHeaders = await readFile(headerFile, "utf8");
    const headers = new Headers();
    // Use the last header block (after any redirects/100-continue).
    const blocks = rawHeaders.split(/\r?\n\r?\n/).filter((b) => b.trim());
    for (const line of (blocks[blocks.length - 1] ?? "").split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const name = line.slice(0, idx).trim().toLowerCase();
        if (name === "content-encoding" || name === "transfer-encoding") continue;
        headers.set(name, line.slice(idx + 1).trim());
      }
    }

    const body = new Uint8Array(await readFile(outFile).catch(() => new Uint8Array()));
    const code = Number(status.trim()) || 502;
    return new Response(code === 204 || body.length === 0 && code === 304 ? null : (body as unknown as BodyInit), {
      status: code,
      headers,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}) as typeof fetch;
