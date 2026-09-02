/**
 * Single-file dashboard, embedded so the installed package stays
 * self-contained and fully offline (no CDN, no build tooling).
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>aem — Agent Environment</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;
    --dim: #8b949e; --accent: #58a6ff; --ok: #3fb950; --warn: #d29922;
    --err: #f85149; --crit: #ff7b72; --chip: #21262d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 20px;
    border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); }
  header h1 { font-size: 16px; margin: 0; }
  header .ver { color: var(--dim); }
  header .spacer { flex: 1; }
  header button { background: var(--chip); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; }
  header button:hover { border-color: var(--accent); }
  #meta { color: var(--dim); font-size: 12px; }
  main { padding: 20px; max-width: 1200px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px; margin-bottom: 20px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .card .num { font-size: 26px; font-weight: 700; }
  .card .label { color: var(--dim); font-size: 12px; }
  section { margin-bottom: 26px; }
  section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--dim); border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--dim); font-weight: 600; padding: 6px 10px; }
  td { padding: 6px 10px; border-top: 1px solid var(--border); vertical-align: top; }
  tr:hover td { background: rgba(88,166,255,.04); }
  .chip { display: inline-block; background: var(--chip); border: 1px solid var(--border);
    border-radius: 999px; padding: 1px 9px; font-size: 11px; margin: 1px 2px 1px 0; white-space: nowrap; }
  .ok { color: var(--ok); border-color: var(--ok); }
  .warn { color: var(--warn); border-color: var(--warn); }
  .err { color: var(--err); border-color: var(--err); }
  .crit { color: var(--crit); border-color: var(--crit); font-weight: 700; }
  .dim { color: var(--dim); }
  .mono { word-break: break-all; }
  .finding { background: var(--panel); border: 1px solid var(--border); border-left-width: 3px;
    border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; }
  .finding.warning { border-left-color: var(--warn); }
  .finding.error { border-left-color: var(--err); }
  .finding.critical { border-left-color: var(--crit); }
  .finding.info { border-left-color: var(--accent); }
  .finding .t { font-weight: 700; }
  .finding .s { color: var(--dim); font-size: 12px; }
  .empty { color: var(--dim); padding: 10px 0; }
  #error { color: var(--err); padding: 20px; display: none; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>aem</h1><span class="ver" id="version"></span>
  <span id="driftbadge"></span>
  <span class="spacer"></span>
  <span id="meta"></span>
  <button id="refresh">Refresh</button>
</header>
<div id="error"></div>
<main>
  <div class="cards" id="cards"></div>
  <section><h2>Runtimes</h2><div id="runtimes"></div></section>
  <section><h2>MCP Servers</h2><div id="mcp"></div></section>
  <section><h2>Findings</h2><div id="findings"></div></section>
  <section><h2>Drift</h2><div id="drift"></div></section>
  <div class="cols">
    <section><h2>Instructions</h2><div id="instructions"></div></section>
    <section><h2>Skills</h2><div id="skills"></div></section>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function envChips(env) {
  return Object.entries(env || {}).map(([name, ref]) => {
    if (ref.secret && ref.source === "inline") return '<span class="chip crit">' + esc(name) + ' inline!</span>';
    if (ref.source === "env" && ref.present === false) return '<span class="chip warn">' + esc(name) + ' missing</span>';
    if (ref.source === "env") return '<span class="chip ok">' + esc(name) + '</span>';
    return '<span class="chip">' + esc(name) + '</span>';
  }).join("");
}

function render(o) {
  $("version").textContent = "v" + o.version;
  $("meta").textContent = new Date(o.generatedAt).toLocaleString() +
    (o.activeProfile ? " · profile: " + o.activeProfile : "");
  const runtimes = o.snapshot.runtimes;
  const installed = runtimes.filter((r) => r.installed);
  const servers = runtimes.flatMap((r) => r.mcpServers.map((s) => ({ ...s, runtime: r.id })));
  const sev = (level) => o.findings.filter((f) => f.severity === level).length;
  const driftN = o.drift ? o.drift.items.length : null;

  $("driftbadge").innerHTML = o.driftProfile
    ? (driftN === 0
        ? '<span class="chip ok">in sync · ' + esc(o.driftProfile) + '</span>'
        : '<span class="chip warn">drift ' + driftN + ' · ' + esc(o.driftProfile) + '</span>')
    : '<span class="chip dim">no baseline</span>';

  $("cards").innerHTML = [
    ["Runtimes", installed.length + " / " + runtimes.length, "installed / supported"],
    ["MCP Servers", servers.length, servers.filter((s) => s.enabled).length + " enabled"],
    ["Findings", o.findings.length, sev("critical") + " crit · " + sev("error") + " err · " + sev("warning") + " warn"],
    ["Drift", driftN === null ? "—" : driftN, o.driftSource ? "vs " + o.driftSource + " profile" : "no profile"],
    ["Skills", runtimes.reduce((n, r) => n + r.skillPacks.length, 0), "across all vendors"],
  ].map(([l, n, s]) =>
    '<div class="card"><div class="num">' + esc(n) + '</div><div class="label">' + esc(l) + ' · ' + esc(s) + "</div></div>"
  ).join("");

  $("runtimes").innerHTML = "<table><tr><th>runtime</th><th>status</th><th>version</th><th>mcp</th><th>skills</th><th>config sources</th></tr>" +
    runtimes.filter((r) => r.installed).map((r) =>
      "<tr><td><b>" + esc(r.id) + "</b></td>" +
      '<td><span class="chip ok">installed</span></td>' +
      "<td>" + esc(r.version || "—") + "</td>" +
      "<td>" + r.mcpServers.length + "</td>" +
      "<td>" + r.skillPacks.length + "</td>" +
      '<td class="dim mono">' + r.configSources.map((c) => esc(c.path)).join("<br>") + "</td></tr>"
    ).join("") + "</table>" +
    '<div class="dim" style="margin-top:6px">not installed: ' +
    runtimes.filter((r) => !r.installed).map((r) => esc(r.id)).join(", ") + "</div>";

  $("mcp").innerHTML = servers.length === 0 ? '<div class="empty">none detected</div>' :
    "<table><tr><th>id</th><th>runtime</th><th>transport</th><th>command / url</th><th>env</th><th></th></tr>" +
    servers.map((s) =>
      "<tr><td><b>" + esc(s.id) + "</b></td><td>" + esc(s.runtime) + "</td><td>" + esc(s.transport) + "</td>" +
      '<td class="mono dim">' + esc(s.command ? s.command.executable + " " + s.command.args.join(" ") : s.url || "") + "</td>" +
      "<td>" + envChips(s.env) + "</td>" +
      "<td>" + (s.enabled ? "" : '<span class="chip dim">disabled</span>') + "</td></tr>"
    ).join("") + "</table>";

  const sevClass = { critical: "critical", error: "error", warning: "warning", info: "info" };
  $("findings").innerHTML = o.findings.length === 0 ? '<div class="empty ok">No findings — environment looks healthy.</div>' :
    o.findings.map((f) =>
      '<div class="finding ' + sevClass[f.severity] + '"><span class="chip ' +
      (f.severity === "critical" ? "crit" : f.severity === "error" ? "err" : f.severity === "warning" ? "warn" : "") + '">' +
      esc(f.severity) + "</span> <span class=\\"t\\">" + esc(f.title) + '</span> <span class="dim">[' + esc(f.category) +
      (f.runtime ? " · " + esc(f.runtime) : "") + "]</span><br>" + esc(f.message) +
      (f.suggestedAction ? '<br><span class="s">→ ' + esc(f.suggestedAction) + "</span>" : "") + "</div>"
    ).join("");

  $("drift").innerHTML = !o.drift ? '<div class="empty">no profile to compare (run aem init or aem profile use)</div>' :
    o.drift.items.length === 0 ? '<div class="empty ok">No drift vs "' + esc(o.driftProfile) + '".</div>' :
    "<table><tr><th>change</th><th>resource</th><th>runtime</th><th>detail</th></tr>" +
    o.drift.items.map((i) =>
      '<tr><td><span class="chip ' + (i.change === "added" ? "ok" : i.change === "removed" ? "err" : "warn") + '">' +
      esc(i.change) + "</span></td><td><b>" + esc(i.resourceRef) + "</b></td><td>" + esc(i.runtime) + "</td>" +
      '<td class="dim">' + esc(i.detail) + "</td></tr>"
    ).join("") + "</table>";

  const instr = o.snapshot.runtimes.flatMap((r) => r.instructionPacks.map((p) => ({ ...p, runtime: r.id })));
  const seen = new Set();
  $("instructions").innerHTML = instr.length === 0 ? '<div class="empty">none</div>' :
    "<table>" + instr.filter((p) => !seen.has(p.path) && seen.add(p.path)).map((p) =>
      '<tr><td class="mono">' + esc(p.path) + '</td><td class="dim">' + esc(p.type) +
      (p.sizeBytes ? " · " + (p.sizeBytes / 1024).toFixed(1) + " KB" : "") + "</td></tr>"
    ).join("") + "</table>";

  $("skills").innerHTML = "<table>" + o.snapshot.runtimes.filter((r) => r.skillPacks.length > 0).map((r) =>
    "<tr><td><b>" + esc(r.id) + "</b> <span class=\\"dim\\">(" + r.skillPacks.length + ")</span></td><td>" +
    r.skillPacks.map((s) => '<span class="chip">' + esc(s.id) + "</span>").join("") + "</td></tr>"
  ).join("") + "</table>";
}

async function load() {
  $("refresh").disabled = true;
  try {
    const res = await fetch("/api/overview");
    if (!res.ok) throw new Error("HTTP " + res.status);
    render(await res.json());
    $("error").style.display = "none";
  } catch (e) {
    $("error").textContent = "Failed to load: " + e.message;
    $("error").style.display = "block";
  } finally {
    $("refresh").disabled = false;
  }
}
$("refresh").addEventListener("click", load);
load();
</script>
</body>
</html>
`;
