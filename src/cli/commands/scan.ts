import { renderScan } from "../../output/text.js";
import { scanNow } from "../common.js";

export function runScan(opts: {
  json?: boolean;
  vendor: string;
  project?: string;
}): void {
  const { snapshot } = scanNow(opts.vendor, opts.project);
  if (opts.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
  } else {
    process.stdout.write(renderScan(snapshot) + "\n");
  }
}
