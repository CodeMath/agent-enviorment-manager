import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type http from "node:http";
import { makeTempHome, seedFixtureHome } from "./helpers.js";

let home: string;
let server: http.Server;
let base: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  home = makeTempHome();
  seedFixtureHome(home);
  for (const k of ["AEM_HOME", "AEM_NO_EXEC"]) savedEnv[k] = process.env[k];
  process.env.AEM_HOME = home;
  process.env.AEM_NO_EXEC = "1";

  const { createWebServer } = await import("../src/web/server.js");
  server = createWebServer(`${home}/project`);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("web dashboard", () => {
  test("serves the embedded dashboard HTML", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("aem — Agent Environment");
    expect(html).toContain("/api/overview");
    // fully offline: no external resources
    expect(html).not.toMatch(/src="http|href="http/);
  });

  test("overview API returns a fresh redacted snapshot + findings + drift", async () => {
    const res = await fetch(base + "/api/overview");
    expect(res.status).toBe(200);
    const o = await res.json();
    expect(o.snapshot.kind).toBe("EnvironmentSnapshot");
    expect(o.snapshot.runtimes.length).toBeGreaterThanOrEqual(40);
    const codex = o.snapshot.runtimes.find((r: any) => r.id === "codex");
    expect(codex.installed).toBe(true);
    expect(codex.mcpServers.map((s: any) => s.id)).toContain("github");
    expect(o.findings.some((f: any) => f.category === "secret_inline")).toBe(true);
    expect(o.drift).toBeNull(); // no profile yet
    // secret guard holds on the wire
    expect(JSON.stringify(o)).not.toContain("sk-P2vyt");
  });

  test("read-only: non-GET methods and unknown routes are rejected", async () => {
    expect((await fetch(base + "/api/overview", { method: "POST" })).status).toBe(405);
    expect((await fetch(base + "/api/apply", { method: "PUT" })).status).toBe(405);
    expect((await fetch(base + "/api/nope")).status).toBe(404);
  });
});
