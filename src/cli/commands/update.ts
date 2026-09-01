import { spawnSync } from "node:child_process";
import { appendAudit } from "../../core/storage/audit.js";
import {
  RELEASE_REPO,
  compareVersions,
  currentVersion,
  normalizeTag,
} from "../../core/version.js";
import { bold, dim, green, yellow } from "../../output/text.js";
import { failWith } from "../common.js";

interface ReleaseInfo {
  tag: string;
  name?: string;
  url: string;
  publishedAt?: string;
}

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const res = await fetch(
    `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `aem/${currentVersion()}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (res.status === 404) {
    throw new Error(`No releases found for ${RELEASE_REPO}.`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status} ${res.statusText}.`);
  }
  const body = (await res.json()) as {
    tag_name: string;
    name?: string;
    html_url: string;
    published_at?: string;
  };
  return {
    tag: body.tag_name,
    name: body.name,
    url: body.html_url,
    publishedAt: body.published_at,
  };
}

export async function runUpdate(opts: { check?: boolean; yes?: boolean }): Promise<void> {
  const installed = currentVersion();
  process.stdout.write(`Current version: ${bold(installed)}\n`);

  let release: ReleaseInfo;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    failWith(
      `Cannot check releases: ${err instanceof Error ? err.message : String(err)}`,
      `Check your network, or see https://github.com/${RELEASE_REPO}/releases manually.`,
    );
  }

  const latest = normalizeTag(release.tag);
  process.stdout.write(
    `Latest release:  ${bold(latest)} ${dim(`(${release.tag}, ${release.url})`)}\n`,
  );

  const cmp = compareVersions(installed, latest);
  if (cmp >= 0) {
    process.stdout.write(green("Already up to date.\n"));
    return;
  }

  process.stdout.write(
    yellow(`Update available: ${installed} -> ${latest}\n`),
  );
  if (opts.check) {
    process.stdout.write(
      `Run ${bold("aem update")} to install, or:\n` +
        dim(`  npm install -g github:${RELEASE_REPO}#${release.tag}\n`),
    );
    process.exitCode = 4; // update available (machine-checkable)
    return;
  }

  const spec = `github:${RELEASE_REPO}#${release.tag}`;
  process.stdout.write(`Installing ${dim(spec)} via npm...\n`);
  const res = spawnSync("npm", ["install", "-g", spec], {
    stdio: "inherit",
    timeout: 300_000,
  });

  const ok = !res.error && res.status === 0;
  appendAudit({
    at: new Date().toISOString(),
    command: `update ${installed} -> ${latest}`,
    result: ok ? "ok" : "error",
    detail: ok ? undefined : (res.error?.message ?? `npm exited ${res.status}`),
  });

  if (!ok) {
    failWith(
      `npm install failed${res.error ? `: ${res.error.message}` : ` (exit ${res.status})`}`,
      `Try manually: npm install -g ${spec}`,
    );
  }
  process.stdout.write(green(bold(`Updated aem to ${latest}.`)) + "\n");
}
