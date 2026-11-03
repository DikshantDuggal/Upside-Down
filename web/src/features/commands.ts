import { z } from "zod";
import {
  commandSchema,
  receiptSchema,
  type Command,
  type Receipt,
} from "../api/types";
import { ApiError, request, idPath } from "../api/client";

const intentSchema = z.object({
  key: z.uuid(),
  command: commandSchema,
  createdAt: z.string(),
  delivery: z.enum(["unsent", "unknown", "queued"]),
  receipt: receiptSchema.optional(),
  error: z.string().optional(),
});
export type Intent = z.infer<typeof intentSchema>;
export function isDefinitelyUnsent(error: unknown) {
  return (
    error instanceof ApiError &&
    [400, 401, 403, 404, 405, 413, 415, 422, 426, 429].includes(error.status)
  );
}
const documentSchema = z.object({
  version: z.literal(1),
  intents: z.array(intentSchema),
});
export class CommandJournal {
  readonly storageKey: string;
  constructor(
    readonly deviceId: string,
    private storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  ) {
    this.storageKey = `upside-down:commands:v1:${encodeURIComponent(deviceId)}`;
  }
  read(): Intent[] {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return [];
    const parsed = documentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new Error(
        "Saved command records could not be read. Do not resend ambiguous actions with new keys.",
      );
    return parsed.data.intents;
  }
  write(intents: Intent[]) {
    this.storage.setItem(
      this.storageKey,
      JSON.stringify({ version: 1, intents }),
    );
  }
  prepare(command: Command) {
    const intent: Intent = {
      key: crypto.randomUUID(),
      command: commandSchema.parse(command),
      createdAt: new Date().toISOString(),
      delivery: "unsent",
    };
    this.write([...this.read(), intent]);
    return intent;
  }
  update(intent: Intent) {
    this.write(
      this.read().map((value) => (value.key === intent.key ? intent : value)),
    );
    return intent;
  }
  async submit(intent: Intent) {
    const hadAmbiguousAttempt = intent.delivery === "unknown";
    // Persist ambiguity BEFORE HTTP; never lose the retry key if the page closes.
    this.update({ ...intent, delivery: "unknown", error: undefined });
    try {
      const { value: receipt } = await request(
        "/local/commands",
        receiptSchema,
        { body: intent.command, key: intent.key, expectedStatus: 202 },
      );
      if (receipt.deviceId !== this.deviceId)
        throw new ApiError(
          "Receipt device identity does not match this local service.",
          0,
          "INVALID_RESPONSE",
        );
      return this.update({ ...intent, delivery: "queued", receipt });
    } catch (error) {
      // Explicit client failures did not queue this request. 408, 409 and server
      // failures keep their original key because an earlier attempt may exist.
      const certain = !hadAmbiguousAttempt && isDefinitelyUnsent(error);
      this.update({
        ...intent,
        delivery: certain ? "unsent" : "unknown",
        error: error instanceof Error ? error.message : "Submission failed",
      });
      throw error;
    }
  }
  async reconcile(receipts: Receipt[]) {
    const intents = this.read();
    for (const intent of intents) {
      if (
        !intent.receipt ||
        !["queued", "sending"].includes(intent.receipt.state)
      )
        continue;
      let receipt = receipts.find(
        (value) => value.eventId === intent.receipt?.eventId,
      );
      if (!receipt) {
        try {
          receipt = (
            await request(
              `/local/commands/${idPath(intent.receipt.eventId)}`,
              receiptSchema,
            )
          ).value;
        } catch {
          continue;
        } // An unavailable receipt is never treated as applied.
      }
      if (receipt.deviceId === this.deviceId)
        this.update({ ...intent, receipt });
    }
    return this.read();
  }
}
export function isUnsettled(intent: Intent) {
  return (
    intent.delivery === "unknown" ||
    (intent.delivery === "queued" &&
      (!intent.receipt || ["queued", "sending"].includes(intent.receipt.state)))
  );
}
export function transitionBlocked(
  taskId: string,
  pending: Receipt[],
  intents: Intent[],
  currentRevision?: number,
) {
  const pendingReceipts = pending.filter((receipt) =>
    ["queued", "sending"].includes(receipt.state),
  );
  const unknownAssociation = pendingReceipts.some(
    (receipt) =>
      !intents.some((intent) => intent.receipt?.eventId === receipt.eventId),
  );
  return (
    unknownAssociation ||
    intents.some(
      (intent) =>
        intent.command.type === "task.transition" &&
        intent.command.taskId === taskId &&
        (isUnsettled(intent) ||
          (intent.receipt?.state === "applied" &&
            currentRevision !== undefined &&
            currentRevision <= intent.command.baseRevision)),
    )
  );
}
