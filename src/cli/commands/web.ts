import { spawn } from "node:child_process";
import { createWebServer } from "../../web/server.js";
import { bold, dim, green } from "../../output/text.js";
import { failWith } from "../common.js";

/**
 * Read-only local dashboard. Binds 127.0.0.1 only — this is a viewer,
 * not a remote management surface; mutations stay in the CLI.
 */
export function runWeb(opts: { port: string; open?: boolean }): void {
  const port = Number.parseInt(opts.port, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    failWith(`Invalid port "${opts.port}".`);
  }
  const server = createWebServer();
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      failWith(
        `Port ${port} is already in use.`,
        `Try \`aem web --port ${port + 1}\`.`,
      );
    }
    failWith(err.message);
  });
  server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    const url = `http://127.0.0.1:${actualPort}`;
    process.stdout.write(
      green(bold(`aem dashboard: `)) + url + "\n" +
        dim("Read-only viewer (scan/doctor/drift). Ctrl+C to stop.\n"),
    );
    if (opts.open !== false && process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    }
  });
}
