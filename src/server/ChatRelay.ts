import {
  CHAT_MAX_LENGTH,
  ChatEntry,
  ClientChatMessage,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import { TextCensor, asteriskCensorStrategy } from "obscenity";
import { profanityMatcher } from "./Censor";
import { ChatEnv } from "./ChatEnv";
import { Client } from "./Client";

const HISTORY_SIZE = 50;
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 10_000;

export interface ChatRelayDeps {
  // Everyone currently connected (players and spectators).
  recipients: () => readonly Client[];
  send: (client: Client, msg: ServerMessage) => void;
  turn: () => number;
  now?: () => number;
}

const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

// Chat is never an intent: nothing here reaches a Turn, the turn log, the
// archive or a replay. The ring buffer lives in memory for the life of the
// game and is dropped with the GameServer.
export class ChatRelay {
  private readonly history: ChatEntry[] = [];
  private readonly sentAt = new Map<string, number[]>();
  private nextId = 1;

  constructor(private readonly deps: ChatRelayDeps) {}

  handle(client: Client, msg: ClientChatMessage): void {
    const err = (reason: "muted" | "rate_limited" | "too_long" | "disabled") =>
      this.deps.send(client, { type: "chat_error", reason });
    const now = (this.deps.now ?? Date.now)();

    if (!ChatEnv.enabled()) return err("disabled");
    if (
      client.chatMute &&
      client.chatMute.until > now &&
      !client.chatMute.shadow
    ) {
      return err("muted");
    }
    const trimmed = msg.text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > CHAT_MAX_LENGTH) return err("too_long");
    if (!this.allow(client.clientID, now)) return err("rate_limited");

    const entry: ChatEntry = {
      id: this.nextId++,
      fromClientID: client.clientID,
      channel: msg.channel,
      text: censor.applyTo(trimmed, profanityMatcher.getAllMatches(trimmed)),
      root: client.role === "root",
      system: false,
      turn: this.deps.turn(),
    };

    const shadow = client.chatMute?.shadow && client.chatMute.until > now;
    if (shadow) {
      this.deps.send(client, { type: "chat", ...entry });
      return;
    }
    this.history.push(entry);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
    for (const c of this.deps.recipients()) {
      if (this.canSee(c, entry)) this.deps.send(c, { type: "chat", ...entry });
    }
  }

  // Nothing is sent when there is nothing to show.
  sendHistory(client: Client): void {
    const messages = this.history.filter((e) => this.canSee(client, e));
    if (messages.length === 0) return;
    this.deps.send(client, { type: "chat_history", messages });
  }

  // Alliance frames go to seated players and root only; spectators never get
  // them. The per-alliance filter is client-side (a known, documented leak).
  private canSee(c: Client, e: ChatEntry): boolean {
    return e.channel === "global" || !c.spectator || c.role === "root";
  }

  // At most 5 messages in any 10 s window per client.
  private allow(clientID: string, now: number): boolean {
    const recent = (this.sentAt.get(clientID) ?? []).filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );
    if (recent.length >= RATE_LIMIT_COUNT) {
      this.sentAt.set(clientID, recent);
      return false;
    }
    recent.push(now);
    this.sentAt.set(clientID, recent);
    return true;
  }
}
