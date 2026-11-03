/**
 * Debounced Filesystem Watcher
 * Role 2 — AI Agent Execution Engine
 */

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { WatcherConfig } from "../../contracts/agent.ts";

export class ProjectFileWatcher extends EventEmitter {
  private config: WatcherConfig;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isPaused: boolean = false;
  private pendingChanges: Set<string> = new Set();

  private static readonly DEFAULT_IGNORED = [
    "node_modules",
    ".git",
    ".board",
    "dist",
    "build",
    "data",
    ".cache",
    ".tmp",
  ];

  constructor(config: Partial<WatcherConfig> & { watchDir: string }) {
    super();
    this.config = {
      watchDir: config.watchDir,
      ignoredPatterns: config.ignoredPatterns || ProjectFileWatcher.DEFAULT_IGNORED,
      debounceMs: config.debounceMs || 500,
      testCommand: config.testCommand || "npm test",
    };
  }

  public start(): void {
    if (this.watcher) return;
    if (!fs.existsSync(this.config.watchDir)) {
      throw new Error(`Watch directory does not exist: ${this.config.watchDir}`);
    }

    try {
      this.watcher = fs.watch(
        this.config.watchDir,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (!filename || this.isPaused) return;

          const normalized = filename.replace(/\\/g, "/");
          if (this.isIgnored(normalized)) return;

          this.pendingChanges.add(normalized);
          this.emit("change", { filename: normalized, eventType });

          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }

          this.debounceTimer = setTimeout(() => {
            if (this.pendingChanges.size > 0 && !this.isPaused) {
              const changed = Array.from(this.pendingChanges);
              this.pendingChanges.clear();
              this.emit("triggered", { changedFiles: changed });
            }
          }, this.config.debounceMs);
        }
      );
    } catch (err) {
      console.error("Failed to start ProjectFileWatcher:", err);
      throw err;
    }
  }

  public pause(): void {
    this.isPaused = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();
  }

  public resume(): void {
    this.isPaused = false;
  }

  public stop(): void {
    this.pause();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.removeAllListeners();
  }

  public isIgnored(filePath: string): boolean {
    const parts = filePath.split("/");
    for (const ignored of this.config.ignoredPatterns) {
      if (parts.includes(ignored) || filePath.startsWith(ignored) || filePath.endsWith(ignored)) {
        return true;
      }
    }
    // Ignore database, lock, log, and journal files
    if (/\.(db|db-journal|log|tmp)$/i.test(filePath)) {
      return true;
    }
    return false;
  }
}
