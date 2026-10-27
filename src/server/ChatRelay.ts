import {
  CHAT_MAX_LENGTH,
  ChatEntry,
  ClientChatMessage,
  ServerChatErrorMessage,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import { TextCensor, asteriskCensorStrategy } from "obscenity";
import { profanityMatcher } from "./Censor";
import { apiSub, ChatEnv } from "./ChatEnv";
import { Client } from "./Client";

const HISTORY_SIZE = 50;
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 10_000;
const REPORT_LIMIT = 5;
const REPORT_WINDOW_MS = 60_000;
const DEFAULT_MUTE_MINUTES = 10;
const MAX_MUTE_MINUTES = 5 * 365 * 24 * 60;
const ROOT_COMMAND =
  /^\/(mute|shadow|unmute|kick|say|endgame|unranked)(?:\s+([\s\S]*))?$/i;

export interface ChatRelayDeps {
  // Everyone currently connected (players and spectators).
  recipients: () => readonly Client[];
  send: (client: Client, msg: ServerMessage) => void;
  turn: () => number;
  // The admin kick path (GameServer.kickClient with the admin reason).
  kick: (clientID: string) => void;
  gameId: () => string;
  // Root /endgame and /unranked (S6): the GameServer methods.
  endGame: () => void;
  markUnranked: () => void;
  now?: () => number;
}

const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

// Chat is never an intent: nothing here reaches a Turn, the turn log, the
// archive or a replay. The ring buffer lives in memory for the life of the
// game and is dropped with the GameServer.
export class ChatRelay {
  private readonly history: ChatEntry[] = [];
  private readonly sentAt = new Map<string, number[]>();
  private readonly senderSub = new Map<number, string>();
  private readonly reportedAt = new Map<string, number[]>();
  private nextId = 1;

  constructor(private readonly deps: ChatRelayDeps) {}

  handle(client: Client, msg: ClientChatMessage): void {
    const err = (reason: ServerChatErrorMessage["reason"]) =>
      this.deps.send(client, { type: "chat_error", reason });
    const now = (this.deps.now ?? Date.now)();

    if (!ChatEnv.enabled()) return err("disabled");
    // Commands run only for root; for anyone else "/x" is ordinary text.
    const cmd =
      client.role === "root" && msg.text.length <= CHAT_MAX_LENGTH
        ? ROOT_COMMAND.exec(msg.text.trim())
        : null;
    if (cmd) {
      return this.command(client, cmd[1].toLowerCase(), cmd[2] ?? "", now);
    }
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
    if (client.claims?.sub) this.senderSub.set(entry.id, client.claims.sub);
    this.publish(entry);
  }

  private publish(entry: ChatEntry): void {
    this.history.push(entry);
    if (this.history.length > HISTORY_SIZE) {
      this.senderSub.delete(this.history.shift()!.id);
    }
    for (const c of this.deps.recipients()) {
      if (this.canSee(c, entry)) this.deps.send(c, { type: "chat", ...entry });
    }
  }

  // /mute|/shadow <name> [minutes], /unmute <name>, /kick <name>, /say <text>.
  // Never buffered, except /say. API calls are fire-and-forget: the in-game
  // effect applies regardless.
  private command(root: Client, name: string, args: string, now: number): void {
    const fail = (reason: ServerChatErrorMessage["reason"]) =>
      this.deps.send(root, { type: "chat_error", reason });
    const actor = root.username;
    if (name === "say") {
      const text = args.trim();
      if (text.length === 0) return fail("bad_command");
      this.publish({
        id: this.nextId++,
        fromClientID: root.clientID,
        channel: "global",
        text,
        root: true,
        system: true,
        turn: this.deps.turn(),
      });
      ChatEnv.post("/game-server/audit", {
        actor,
        action: "say",
        detail: { text },
      });
      return;
    }
    if (name === "endgame" || name === "unranked") {
      if (name === "endgame") this.deps.endGame();
      else this.deps.markUnranked();
      ChatEnv.post("/game-server/audit", {
        actor,
        action: name === "endgame" ? "end_game" : "game_unranked",
        target: this.deps.gameId(),
      });
      return;
    }
    const words = args.trim().split(/\s+/).filter(Boolean);
    let minutes = DEFAULT_MUTE_MINUTES;
    if (
      (name === "mute" || name === "shadow") &&
      words.length > 1 &&
      /^\d+$/.test(words[words.length - 1])
    ) {
      minutes = Number(words.pop());
      if (minutes < 1 || minutes > MAX_MUTE_MINUTES) return fail("bad_command");
    }
    const wanted = words.join(" ").toLowerCase();
    if (wanted.length === 0) return fail("bad_command");
    const target = this.deps.recipients().find(
      (c) =>
        c.username.toLowerCase() === wanted ||
        c.clientID.toLowerCase() === wanted, // the moderation modal sends the clientID
    );
    if (!target) return fail("no_such_player");
    const targetSub = target.claims?.sub ? apiSub(target.claims.sub) : null;

    if (name === "kick") {
      if (target === root) return fail("bad_command");
      this.deps.kick(target.clientID);
      ChatEnv.post("/game-server/audit", {
        actor,
        action: "kick",
        target: target.username,
      });
    } else if (name === "unmute") {
      target.chatMute = null;
      if (targetSub) {
        ChatEnv.post("/game-server/unmute", {
          actorUsername: actor,
          targetSub,
        });
      }
    } else {
      const shadow = name === "shadow";
      target.chatMute = { until: now + minutes * 60_000, shadow };
      if (targetSub) {
        ChatEnv.post("/game-server/mute", {
          actorUsername: actor,
          targetSub,
          minutes,
          shadow,
        });
      }
    }
  }

  // The stored text always comes from the ring buffer, never from the client.
  report(client: Client, messageId: number): void {
    const now = (this.deps.now ?? Date.now)();
    const recent = (this.reportedAt.get(client.clientID) ?? []).filter(
      (t) => now - t < REPORT_WINDOW_MS,
    );
    this.reportedAt.set(client.clientID, recent);
    if (recent.length >= REPORT_LIMIT) return;
    const entry = this.history.find((e) => e.id === messageId);
    const targetSub = this.senderSub.get(messageId);
    const reporterSub = client.claims?.sub;
    if (
      !entry ||
      entry.system ||
      entry.fromClientID === client.clientID ||
      !targetSub ||
      !reporterSub
    ) {
      return;
    }
    recent.push(now);
    ChatEnv.post("/game-server/chat-report", {
      gameId: this.deps.gameId(),
      reporterSub: apiSub(reporterSub),
      targetSub: apiSub(targetSub),
      message: entry.text,
    });
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
