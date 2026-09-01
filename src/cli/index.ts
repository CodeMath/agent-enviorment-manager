#!/usr/bin/env node
import { Command } from "commander";
import { runApply, runDiff } from "./commands/diffApply.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runDrift } from "./commands/drift.js";
import { runExport, runImport } from "./commands/exportImport.js";
import {
  runProfileDelete,
  runProfileList,
  runProfileShow,
  runProfileUse,
} from "./commands/profile.js";
import { runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";
import { runUpdate } from "./commands/update.js";
import { currentVersion } from "../core/version.js";

const program = new Command();

program
  .name("aem")
  .description(
    "Agent Environment Manager - detect, normalize and manage your local AI agent environment (Claude Code, Codex).",
  )
  .version(currentVersion());

program
  .command("scan")
  .description("Detect installed agent runtimes, MCP servers, instructions and skills")
  .option("--json", "machine-readable JSON output")
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--project <path>", "project directory for project-scope config")
  .action((opts) => runScan(opts));

program
  .command("doctor")
  .description("Diagnose risky, broken or missing environment configuration")
  .option("--json", "machine-readable JSON output")
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--profile <name>", "also check drift against a profile")
  .option("--project <path>", "project directory for project-scope config")
  .action((opts) => runDoctorCommand(opts));

program
  .command("export")
  .description("Save the current environment as a redacted desired-state profile")
  .requiredOption("--profile <name>", "profile name")
  .option("--out <path>", "write to a file instead of the local profile store")
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--force", "overwrite an existing profile")
  .action((opts) => runExport(opts));

program
  .command("import <file>")
  .description("Register a desired-state profile file into the local store")
  .option("--name <name>", "import under a different profile name")
  .option("--force", "overwrite an existing profile")
  .action((file, opts) => runImport({ file, ...opts }));

program
  .command("init")
  .description(
    "Create <cwd>/.aem/desired-state.yaml — a committable project-scope baseline",
  )
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--force", "overwrite an existing project profile")
  .action((opts) => runInit(opts));

const profile = program
  .command("profile")
  .description("Manage saved profiles");
profile.command("list").description("List profiles").action(runProfileList);
profile
  .command("show <name>")
  .description("Print a profile as YAML")
  .action(runProfileShow);
profile
  .command("use <name>")
  .description("Set the active profile")
  .action(runProfileUse);
profile
  .command("delete <name>")
  .description("Delete a profile")
  .action(runProfileDelete);

program
  .command("diff")
  .description("Show the change plan between a profile and the current environment")
  .option("--profile <name>", "profile name (defaults to active profile)")
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--json", "machine-readable JSON output")
  .action((opts) => runDiff(opts));

program
  .command("apply")
  .description("Apply a profile to vendor-native config (with backup)")
  .option("--profile <name>", "profile name (defaults to active profile)")
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--dry-run", "show the change plan without touching any file")
  .option("--yes", "apply without interactive confirmation")
  .action((opts) => runApply(opts));

program
  .command("drift")
  .description("Detect drift between a profile and the current environment")
  .option("--profile <name>", "profile name (defaults to active profile)")
  .option("--vendor <vendor>", "vendor id (codex, claude, gemini, cursor, ...) or all", "all")
  .option("--json", "machine-readable JSON output")
  .action((opts) => runDrift(opts));

program
  .command("update")
  .description("Check GitHub releases for a newer aem version and self-update")
  .option("--check", "only check; exit code 4 when an update is available")
  .action((opts) => runUpdate(opts));

program.parseAsync(process.argv);
