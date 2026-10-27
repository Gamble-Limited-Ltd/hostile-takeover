import { GameEvent } from "@openfront/shared/EventBus";
import type {
  ChatChannel,
  ChatEntry,
  ServerChatErrorMessage,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import type { PlayerView } from "./view";

// Asks Transport to send a chat message (never an intent).
export class SendChatEvent implements GameEvent {
  constructor(
    public readonly channel: ChatChannel,
    public readonly text: string,
  ) {}
}

// Asks Transport to report a chat message by its server id (S3). The server
// reads the text from its own buffer.
export class ReportChatEvent implements GameEvent {
  constructor(public readonly messageId: number) {}
}

export interface ChatViewContext {
  me: PlayerView | null | undefined;
  sender: PlayerView | null | undefined;
  isRoot: boolean;
}

// Whether a chat line is shown to the local player. The Alliance channel is
// filtered here, on the client: the server sends alliance frames to every
// seated player and root, so a modified client could read other alliances'
// messages. Known leak, decided (no server-side alliance tracking); the
// team channel doubles as alliance in team games (isFriendly).
export function chatVisible(e: ChatEntry, ctx: ChatViewContext): boolean {
  if (!e.system && ctx.sender && chatState.isMuted(ctx.sender.displayName())) {
    return false;
  }
  if (e.channel === "global" || ctx.isRoot) return true;
  if (ctx.me && e.fromClientID === ctx.me.clientID()) return true;
  return !!ctx.me && !!ctx.sender && ctx.me.isFriendly(ctx.sender);
}

const MUTED_KEY = "ht.chat.muted";

export type ChatLogItem =
  | { kind: "message"; entry: ChatEntry }
  | { kind: "error"; reason: ServerChatErrorMessage["reason"] };

const MAX_ITEMS = 100;

// The chat log of the current game plus the channel the input is on. Fed by
// ClientGameRunner from the server's chat frames; read by ChatDisplay.
function loadMuted(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MUTED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

class ChatState {
  channel: ChatChannel = "global";
  // Set by ChatInput once the account's role is known.
  isRoot = false;
  // Bumped when the mute list changes so the display rebuilds its lines.
  version = 0;
  private muted = new Set<string>(loadMuted());
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

  // Client mute by display name (a sender's account id is not on the client).
  isMuted(name: string): boolean {
    return this.muted.has(name);
  }

  mute(name: string): void {
    this.muted.add(name);
    this.mutedChanged();
  }

  unmuteAll(): void {
    this.muted.clear();
    this.mutedChanged();
  }

  mutedCount(): number {
    return this.muted.size;
  }

  private mutedChanged(): void {
    this.version++;
    try {
      localStorage.setItem(MUTED_KEY, JSON.stringify([...this.muted]));
    } catch {
      // storage can be blocked; the mute still lasts for this session
    }
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
