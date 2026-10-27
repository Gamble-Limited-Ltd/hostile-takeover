import { GameEvent } from "@openfront/shared/EventBus";
import type {
  ChatChannel,
  ChatEntry,
  ServerChatErrorMessage,
  ServerMessage,
} from "@openfront/shared/WireSchemas";

// Asks Transport to send a chat message (never an intent).
export class SendChatEvent implements GameEvent {
  constructor(
    public readonly channel: ChatChannel,
    public readonly text: string,
  ) {}
}

export type ChatLogItem =
  | { kind: "message"; entry: ChatEntry }
  | { kind: "error"; reason: ServerChatErrorMessage["reason"] };

const MAX_ITEMS = 100;

// The chat log of the current game plus the channel the input is on. Fed by
// ClientGameRunner from the server's chat frames; read by ChatDisplay.
class ChatState {
  channel: ChatChannel = "global";
  private items: ChatLogItem[] = [];
  private listeners = new Set<() => void>();

  log(): readonly ChatLogItem[] {
    return this.items;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(): void {
    this.items = [];
    this.channel = "global";
    this.emit();
  }

  toggleChannel(): ChatChannel {
    this.channel = this.channel === "global" ? "alliance" : "global";
    return this.channel;
  }

  // Returns true when the message was a chat frame.
  handle(msg: ServerMessage): boolean {
    switch (msg.type) {
      case "chat": {
        const entry: ChatEntry = {
          id: msg.id,
          fromClientID: msg.fromClientID,
          channel: msg.channel,
          text: msg.text,
          root: msg.root,
          system: msg.system,
          turn: msg.turn,
        };
        this.push({ kind: "message", entry });
        return true;
      }
      case "chat_history": {
        // Replaces the log: sent right after (re)joining.
        this.items = msg.messages.map((entry) => ({ kind: "message", entry }));
        this.emit();
        return true;
      }
      case "chat_error":
        this.push({ kind: "error", reason: msg.reason });
        return true;
      default:
        return false;
    }
  }

  private push(item: ChatLogItem): void {
    this.items = [...this.items, item].slice(-MAX_ITEMS);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const chatState = new ChatState();
