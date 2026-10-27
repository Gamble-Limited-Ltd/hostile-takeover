import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { CHAT_MAX_LENGTH, ChatChannel } from "@openfront/shared/WireSchemas";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { chatState, SendChatEvent } from "../../ChatState";
import { Controller } from "../../Controller";
import { Features } from "../../Features";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

// "/a hello" and "/g hello" pick the channel for that message and are stripped.
export function parseChatInput(
  raw: string,
  channel: ChatChannel,
): { channel: ChatChannel; text: string } {
  const m = /^\/([ag])\s+/i.exec(raw);
  if (m) {
    return {
      channel: m[1].toLowerCase() === "a" ? "alliance" : "global",
      text: raw.slice(m[0].length).trim(),
    };
  }
  return { channel, text: raw.trim() };
}

@customElement("chat-input")
export class ChatInput extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;
  // Root spectators may type; the server enforces it too.
  public isRoot = false;

  @state() private open = false;
  @state() private channel: ChatChannel = "global";

  init() {
    window.addEventListener("keydown", this.onWindowKeyDown);
    void import("../../Auth")
      .then(({ userAuth }) => userAuth(false))
      .then((auth) => {
        this.isRoot = auth !== false && auth.claims.role === "root";
        chatState.isRoot = this.isRoot;
      })
      .catch(() => {});
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onWindowKeyDown);
    super.disconnectedCallback();
  }

  // Dead players and spectators read only; the server drops what they send.
  canType(): boolean {
    if (!Features.chat) return false;
    if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
      return false;
    }
    return !this.game.isSpectator() || this.isRoot;
  }

  private onWindowKeyDown = (e: KeyboardEvent) => {
    if (this.open || (e.code !== "Enter" && e.code !== "NumpadEnter")) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    ) {
      return;
    }
    // Enter confirms a ghost structure (InputHandler); that keeps working.
    if (this.uiState.ghostStructure !== null) return;
    if (!this.canType()) return;
    e.preventDefault();
    this.openInput();
  };

  openInput() {
    this.channel = chatState.channel;
    this.open = true;
    void this.updateComplete.then(() => this.inputEl()?.focus());
  }

  closeInput() {
    this.open = false;
  }

  private inputEl(): HTMLInputElement | null {
    return this.querySelector("input");
  }

  private setChannel(channel: ChatChannel) {
    chatState.channel = channel;
    this.channel = channel;
  }

  private onInputKeyDown(e: KeyboardEvent) {
    // Typing never reaches the game's hotkeys.
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeInput();
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.setChannel(chatState.toggleChannel());
    } else if (e.key === "Enter") {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const { channel, text } = parseChatInput(input.value, this.channel);
      // "/word" is a root command; for everyone else it is not sent at all.
      if (text.length > 0 && (this.isRoot || !text.startsWith("/"))) {
        this.eventBus.emit(new SendChatEvent(channel, text));
      }
      input.value = "";
      this.closeInput();
    }
  }

  render() {
    if (!this.open) return html``;
    return html`
      <div
        class="pointer-events-auto flex items-center gap-2 rounded-md bg-black/60 p-1.5 w-full lg:max-w-[30vw]"
      >
        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-[14px] font-bold text-white"
          data-channel=${this.channel}
          >${translateText(`chat.channel_${this.channel}`)}</span
        >
        <input
          class="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-zinc-800 ring-1 ring-white/10 text-sm outline-none focus:ring-white/30"
          type="text"
          maxlength=${CHAT_MAX_LENGTH}
          placeholder=${translateText("chat.input_placeholder")}
          @keydown=${(e: KeyboardEvent) => this.onInputKeyDown(e)}
          @keyup=${(e: KeyboardEvent) => e.stopPropagation()}
        />
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
