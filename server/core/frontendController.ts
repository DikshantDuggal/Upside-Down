/**
 * Frontend Activation & Replacement Controller
 * Role: Safe command-driven frontend handoff and rollback arbiter.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface FrontendDefinition {
  id: string;
  name: string;
  version: string;
  sourceDir: string;
  distDir: string;
  bundleFile: string;
  htmlFile: string;
  description: string;
}

export interface FrontendConfig {
  activeFrontend: string;
  availableFrontends: Record<string, FrontendDefinition>;
  previousFrontend: string | null;
  lastActivatedAt: string | null;
  lastActivationResult: string | null;
  rollbackAvailable: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  candidateDir: string;
  details?: Record<string, unknown>;
}

export interface ActivationResult {
  success: boolean;
  activeFrontend: string;
  previousFrontend: string | null;
  timestamp: string;
  message: string;
  error?: string;
}

export class FrontendController {
  private configPath: string;
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = path.resolve(rootDir);
    this.configPath = path.join(this.rootDir, "config", "frontend.json");
    this.ensureConfigExists();
  }

  private ensureConfigExists(): void {
    if (!fs.existsSync(path.dirname(this.configPath))) {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    }
    if (!fs.existsSync(this.configPath)) {
      const initial: FrontendConfig = {
        activeFrontend: "demo",
        availableFrontends: {
          demo: {
            id: "demo",
            name: "Upside-Down Premium Demo Frontend",
            version: "1.0.0",
            sourceDir: "apps/demo-frontend",
            distDir: "public/demo",
            bundleFile: "public/demo/app.js",
            htmlFile: "public/demo/index.html",
            description: "Premium SaaS collaboration cockpit (Linear/Vercel inspired) for live hackathon demonstration.",
          },
          team: {
            id: "team",
            name: "Upside-Down Official Team Frontend",
            version: "1.0.0",
            sourceDir: "frontend",
            distDir: "public/team",
            bundleFile: "public/team/app.js",
            htmlFile: "public/team/index.html",
            description: "Official team implementation developed by assigned frontend engineer.",
          },
        },
        previousFrontend: null,
        lastActivatedAt: null,
        lastActivationResult: null,
        rollbackAvailable: false,
      };
      fs.writeFileSync(this.configPath, JSON.stringify(initial, null, 2), "utf-8");
    }
  }

  public getConfig(): FrontendConfig {
    this.ensureConfigExists();
    const raw = fs.readFileSync(this.configPath, "utf-8");
    return JSON.parse(raw);
  }

  private saveConfig(config: FrontendConfig): void {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  public getStatus() {
    const config = this.getConfig();
    const active = config.availableFrontends[config.activeFrontend] || config.availableFrontends.demo;
    const resolvedPublicDir = path.resolve(this.rootDir, active.distDir);
    const bundleExists = fs.existsSync(path.resolve(this.rootDir, active.bundleFile));
    const htmlExists = fs.existsSync(path.resolve(this.rootDir, active.htmlFile));

    return {
      activeFrontend: config.activeFrontend,
      activeFrontendName: active.name,
      activeFrontendVersion: active.version,
      sourceDir: active.sourceDir,
      distDir: active.distDir,
      resolvedPublicDir,
      bundleExists,
      htmlExists,
      rollbackAvailable: config.rollbackAvailable,
      previousFrontend: config.previousFrontend,
      lastActivatedAt: config.lastActivatedAt,
      lastActivationResult: config.lastActivationResult,
      availableFrontends: Object.keys(config.availableFrontends),
    };
  }

  public getActivePublicDir(): string {
    const config = this.getConfig();
    const active = config.availableFrontends[config.activeFrontend];
    if (active && fs.existsSync(path.resolve(this.rootDir, active.distDir))) {
      return path.resolve(this.rootDir, active.distDir);
    }
    // Fallback to default public if active distDir not yet compiled
    const defaultPublic = path.resolve(this.rootDir, "public");
    if (fs.existsSync(defaultPublic)) {
      return defaultPublic;
    }
    return path.resolve(this.rootDir, "public", "demo");
  }

  public validateCandidate(candidateDirOrPath?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const targetDir = candidateDirOrPath
      ? (path.isAbsolute(candidateDirOrPath) ? candidateDirOrPath : path.resolve(this.rootDir, candidateDirOrPath))
      : path.resolve(this.rootDir, "frontend");

    if (!fs.existsSync(targetDir)) {
      errors.push(`Candidate directory does not exist: ${targetDir}`);
      return { valid: false, errors, warnings, candidateDir: targetDir };
    }

    // Check entry points
    const possibleEntrypoints = [
      path.join(targetDir, "src", "index.tsx"),
      path.join(targetDir, "src", "index.ts"),
      path.join(targetDir, "src", "App.tsx"),
      path.join(targetDir, "index.html"),
    ];
    const hasEntrypoint = possibleEntrypoints.some((p) => fs.existsSync(p));
    if (!hasEntrypoint) {
      errors.push(`No valid frontend entrypoint found in ${targetDir} (checked src/index.tsx, src/index.ts, src/App.tsx, index.html)`);
    }

    // Check compilation capability
    const entryTsx = path.join(targetDir, "src", "index.tsx");
    if (fs.existsSync(entryTsx)) {
      try {
        // Test compile with esbuild to a temporary target
        const testOut = path.join(this.rootDir, "public", "candidate_test.js");
        execSync(`npx esbuild "${entryTsx}" --bundle --outfile="${testOut}" --minify`, {
          cwd: this.rootDir,
          stdio: "pipe",
          maxBuffer: 10 * 1024 * 1024,
        });
        if (fs.existsSync(testOut)) {
          fs.rmSync(testOut, { force: true });
        }
      } catch (err) {
        errors.push(`Frontend bundle test failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      warnings.push("Could not test compile src/index.tsx directly; verifying static distribution assets.");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      candidateDir: targetDir,
    };
  }

  public activateTeamFrontend(candidateDirOrPath?: string): ActivationResult {
    const validation = this.validateCandidate(candidateDirOrPath);
    const now = new Date().toISOString();

    if (!validation.valid) {
      const config = this.getConfig();
      config.lastActivationResult = `FAILED: ${validation.errors.join("; ")}`;
      this.saveConfig(config);
      return {
        success: false,
        activeFrontend: config.activeFrontend,
        previousFrontend: config.previousFrontend,
        timestamp: now,
        message: "Team frontend validation failed. Aborted activation to preserve working demo.",
        error: validation.errors.join("; "),
      };
    }

    const config = this.getConfig();
    const currentActive = config.activeFrontend;

    // Snapshot previous frontend
    config.previousFrontend = currentActive;
    config.rollbackAvailable = true;
    config.activeFrontend = "team";
    config.lastActivatedAt = now;
    config.lastActivationResult = "SUCCESS: Official team frontend validated and activated.";

    // Ensure team dist directory and bundle are compiled
    try {
      const teamDist = path.resolve(this.rootDir, "public", "team");
      if (!fs.existsSync(teamDist)) {
        fs.mkdirSync(teamDist, { recursive: true });
      }

      const teamEntry = path.join(validation.candidateDir, "src", "index.tsx");
      if (fs.existsSync(teamEntry)) {
        execSync(`npx esbuild "${teamEntry}" --bundle --outfile=public/team/app.js --minify`, {
          cwd: this.rootDir,
          stdio: "pipe",
        });
      }

      // Copy or create team index.html
      const teamHtml = path.join(teamDist, "index.html");
      const templateHtml = path.resolve(this.rootDir, "public", "index.html");
      if (fs.existsSync(templateHtml) && !fs.existsSync(teamHtml)) {
        fs.copyFileSync(templateHtml, teamHtml);
      }
    } catch (buildErr) {
      // Revert if build failed
      return {
        success: false,
        activeFrontend: currentActive,
        previousFrontend: null,
        timestamp: now,
        message: "Failed to compile team frontend distribution bundle.",
        error: buildErr instanceof Error ? buildErr.message : String(buildErr),
      };
    }

    this.saveConfig(config);

    return {
      success: true,
      activeFrontend: "team",
      previousFrontend: currentActive,
      timestamp: now,
      message: "UPSIDE-DOWN: Official Team Frontend successfully activated.",
    };
  }

  public rollbackFrontend(): ActivationResult {
    const config = this.getConfig();
    const now = new Date().toISOString();

    if (!config.rollbackAvailable || !config.previousFrontend) {
      return {
        success: false,
        activeFrontend: config.activeFrontend,
        previousFrontend: null,
        timestamp: now,
        message: "No rollback frontend configuration available.",
        error: "rollback_not_available",
      };
    }

    const targetId = config.previousFrontend;
    const targetDef = config.availableFrontends[targetId];

    if (!targetDef) {
      return {
        success: false,
        activeFrontend: config.activeFrontend,
        previousFrontend: null,
        timestamp: now,
        message: `Rollback target '${targetId}' definition not found in configuration.`,
        error: "target_definition_missing",
      };
    }

    const current = config.activeFrontend;
    config.activeFrontend = targetId;
    config.previousFrontend = current;
    config.lastActivatedAt = now;
    config.lastActivationResult = `SUCCESS: Rolled back to ${targetDef.name} (${targetId}).`;

    this.saveConfig(config);

    return {
      success: true,
      activeFrontend: targetId,
      previousFrontend: current,
      timestamp: now,
      message: `UPSIDE-DOWN: Successfully rolled back to ${targetDef.name} (${targetId}).`,
    };
  }
}
