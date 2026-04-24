import { TypedEventBus } from "./createEventBus";

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
    | { type: "ai-open-settings" };

export const appEventBus = new TypedEventBus<AppEvent>();
