import { TypedEventBus } from "./createEventBus";
import type { BackupEntry } from "$lib/errorGuard";

export type AppEvent =
    | {
          type: "dictionary-open";
          word: string;
          selectionFrom: number;
          selectionTo: number;
          x: number;
          y: number;
      }
    | { type: "ai-open-chat"; message: string }
    | { type: "ai-open-settings" }
    | { type: "restore-backup"; backup: BackupEntry }
    | { type: "manual-review" }
    | { type: "show-changelog" }
    | { type: "show-update-banner"; version: string; mas: boolean }
    | { type: "show-auth-modal" }
    | { type: "caret-moved"; x: number; y: number }
    | { type: "stop-ai" };

export const appEventBus = new TypedEventBus<AppEvent>();
