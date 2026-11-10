// Load the installed Hypit Distribution the way bin/hypit.mjs does, so tests import the same public
// SDK (`@hypit/hypit/*`) and model packages the CLI resolves when it activates this Provider.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.HYPIT_DISTRIBUTION
  ?? resolve(dirname(realpathSync(execFileSync("which", ["hypit"], { encoding: "utf8" }).trim())), "..");
const tsxRoot = resolve(root, "node_modules/tsx");
const tsxApi = JSON.parse(readFileSync(resolve(tsxRoot, "package.json"), "utf8")).exports["./esm/api"].import.default;
const { register } = await import(pathToFileURL(resolve(tsxRoot, tsxApi)).href);
register();
const { installDistributionPackageResolution } = await import(
  pathToFileURL(resolve(root, "packages/package-loader-node/src/distribution-resolution.ts")).href);
installDistributionPackageResolution([root]);
