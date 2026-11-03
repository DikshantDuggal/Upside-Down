import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface FrontendDefinition { id: string; name: string; version: string; sourceDir: string; distDir: string; bundleFile: string; htmlFile: string; description: string }
export interface FrontendConfig { activeFrontend: string; availableFrontends: Record<string, FrontendDefinition>; previousFrontend: string | null; lastActivatedAt: string | null; lastActivationResult: string | null; rollbackAvailable: boolean }
export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[]; candidateDir: string; details?: Record<string, unknown> }
export interface ActivationResult { success: boolean; activeFrontend: string; previousFrontend: string | null; timestamp: string; message: string; error?: string }

/** Local activation state affects the web host, never coordinator data or credentials. */
export class FrontendController {
  private rootDir: string;
  private configPath: string;
  constructor(rootDir = process.cwd(), configPath?: string) {
    this.rootDir = path.resolve(rootDir);
    this.configPath = configPath ?? process.env.UD_FRONTEND_CONFIG ?? path.join(this.rootDir, ".board", "frontend.runtime.json");
  }
  private definition(id: string): FrontendDefinition {
    const team = id === "team";
    return { id, name: team ? "Official team dashboard" : "Preserved demo frontend", version: "1.0.0",
      sourceDir: team ? "web" : "apps/demo-frontend", distDir: team ? "web/dist" : "public/demo",
      bundleFile: team ? "web/dist/index.html" : "public/demo/app.js", htmlFile: team ? "web/dist/index.html" : "public/demo/index.html",
      description: team ? "Official React/Vite application" : "Optional rollback interface" };
  }
  getConfig(): FrontendConfig {
    const initial: FrontendConfig = { activeFrontend: "team", availableFrontends: { team: this.definition("team"), demo: this.definition("demo") },
      previousFrontend: "demo", lastActivatedAt: null, lastActivationResult: null, rollbackAvailable: true };
    if (!fs.existsSync(this.configPath)) return initial;
    const config = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as FrontendConfig;
    if (!["team", "demo"].includes(config.activeFrontend)) throw new Error("Unknown active frontend");
    return { ...initial, ...config, availableFrontends: initial.availableFrontends };
  }
  private save(config: FrontendConfig) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = this.configPath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
    try { fs.renameSync(temporary, this.configPath); }
    catch (error) {
      // Windows redirected profiles can map replacement across filesystem layers.
      // This fallback updates only frontend selection metadata, never application data.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      fs.copyFileSync(temporary, this.configPath); fs.unlinkSync(temporary);
    }
  }
  getStatus() {
    const config = this.getConfig(), active = config.availableFrontends[config.activeFrontend];
    return { ...config, activeFrontendName: active.name, activeFrontendVersion: active.version, sourceDir: active.sourceDir,
      distDir: active.distDir, resolvedPublicDir: path.resolve(this.rootDir, active.distDir),
      bundleExists: fs.existsSync(path.resolve(this.rootDir, active.bundleFile)), htmlExists: fs.existsSync(path.resolve(this.rootDir, active.htmlFile)),
      availableFrontends: Object.keys(config.availableFrontends) };
  }
  getActivePublicDir() { return this.getStatus().resolvedPublicDir; }
  private run(script: string, args: string[], cwd: string) {
    execFileSync(process.execPath, [script, ...args], { cwd, windowsHide: true, stdio: "pipe", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  }
  validateCandidate(candidate?: string): ValidationResult {
    const target = path.resolve(this.rootDir, candidate ?? "web"), errors: string[] = [];
    // Only the registered official frontend is activatable; no arbitrary npm scripts.
    if (target !== path.join(this.rootDir, "web")) errors.push("Candidate must be the registered official web/ application");
    if (!fs.existsSync(path.join(target, "index.html")) || !fs.existsSync(path.join(target, "package.json"))) errors.push("Official Vite entrypoint/package is missing");
    if (!errors.length) {
      try {
        this.run(path.join(target, "node_modules/typescript/bin/tsc"), ["--noEmit"], target);
        this.run(path.join(target, "node_modules/vite/bin/vite.js"), ["build"], target);
        const html = fs.readFileSync(path.join(target, "dist/index.html"), "utf8");
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
        if (!assets.some(asset => asset.endsWith(".js")) || assets.some(asset => !fs.existsSync(path.join(target, "dist", asset)))) throw new Error("Built Vite asset references are incomplete");
      } catch { errors.push("Official frontend typecheck/build or asset verification failed; run npm --prefix web run build for diagnostics"); }
    }
    return { valid: errors.length === 0, errors, warnings: [], candidateDir: target };
  }
  activateTeamFrontend(candidate?: string): ActivationResult {
    const checked = this.validateCandidate(candidate), config = this.getConfig(), timestamp = new Date().toISOString();
    if (!checked.valid) return { success: false, activeFrontend: config.activeFrontend, previousFrontend: config.previousFrontend, timestamp,
      message: "Activation refused; current frontend preserved", error: checked.errors.join("; ") };
    if (config.activeFrontend !== "team") config.previousFrontend = config.activeFrontend;
    config.activeFrontend = "team"; config.rollbackAvailable = true; config.lastActivatedAt = timestamp; config.lastActivationResult = "Official web build verified"; this.save(config);
    return { success: true, activeFrontend: "team", previousFrontend: config.previousFrontend, timestamp, message: config.lastActivationResult };
  }
  rollbackFrontend(): ActivationResult {
    const config = this.getConfig(), target = config.previousFrontend, timestamp = new Date().toISOString();
    if (!target || !config.rollbackAvailable) return { success: false, activeFrontend: config.activeFrontend, previousFrontend: target, timestamp, message: "No rollback target available" };
    const definition = config.availableFrontends[target];
    if (!definition || !fs.existsSync(path.join(this.rootDir, definition.htmlFile)) || !fs.existsSync(path.join(this.rootDir, definition.bundleFile))) {
      return { success: false, activeFrontend: config.activeFrontend, previousFrontend: target, timestamp, message: "Rollback assets are missing; build the demo first" };
    }
    const previous = config.activeFrontend; config.activeFrontend = target; config.previousFrontend = previous;
    config.lastActivatedAt = timestamp; config.lastActivationResult = "Rollback assets verified"; this.save(config);
    return { success: true, activeFrontend: target, previousFrontend: previous, timestamp, message: config.lastActivationResult };
  }
}
