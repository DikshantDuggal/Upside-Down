import type { SyncGateway } from "../../contracts/sync.ts";
import { ProtocolError as RouterError } from "../sync/protocol.ts";
import { ProtocolError } from "../core/protocolError.ts";
import { CursorExpiredError } from "../db/database.ts";

/** Preserve A's safe error codes across B's nominal error-class boundary. */
export function adaptGateway(gateway: SyncGateway): SyncGateway {
  async function invoke<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ProtocolError) {
        const translated = new RouterError(error.status, error.code, error.message, error.details);
        translated.body.retryable = error.retryable;
        throw translated;
      }
      if (error instanceof CursorExpiredError) throw new RouterError(410, "CURSOR_EXPIRED", "Replay cursor expired; rebuild from the current journal");
      throw error; // B redacts unexpected failures.
    }
  }
  return {
    process: (...args) => invoke(() => gateway.process(...args)),
    pull: (...args) => invoke(() => gateway.pull(...args)),
    listConflicts: (...args) => invoke(() => gateway.listConflicts(...args)),
    resolve: (...args) => invoke(() => gateway.resolve(...args)),
  };
}
