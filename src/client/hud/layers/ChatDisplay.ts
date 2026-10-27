import { MessageType } from "@openfront/engine-api/game/GameTypes";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import {
  chatState,
  chatVisible,
  ChatLogItem,
  ReportChatEvent,
} from "../../ChatState";
import { rootBadge } from "../../components/ui/RootBadge";
import { Controller } from "../../Controller";
import { showInGameConfirm } from "../../InGameModal";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import { onlyImages } from "./OnlyImages";

interface ChatEvent {
  description: string;
  unsafeDescription?: boolean;
  createdAt: number;
  highlight?: boolean;
  chat?: ChatLogItem; // a Global/Alliance chat line or chat error (S2)
}

@customElement("chat-display")
export class ChatDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;

  private active: boolean = false;

  @state() private _hidden: boolean = false;
  @state() private newEvents: number = 0;
  @state() private chatEvents: ChatEvent[] = [];

  private toggleHidden() {
    this._hidden = !this._hidden;
    if (this._hidden) {
      this.newEvents = 0;
    }
    this.requestUpdate();
  }

  private addEvent(event: ChatEvent) {
    this.chatEvents = [...this.chatEvents, event];
    if (this._hidden) {
      this.newEvents++;
    }
    this.requestUpdate();
  }

  private removeEvent(index: number) {
    this.chatEvents = [
      ...this.chatEvents.slice(0, index),
      ...this.chatEvents.slice(index + 1),
    ];
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    if (event.messageType !== MessageType.CHAT) return;
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    this.addEvent({
      description: event.message,
      createdAt: this.game.ticks(),
      highlight: true,
      unsafeDescription: true,
    });
  }

  private lastChatItem: ChatLogItem | undefined;
  private lastVersion = 0;

  private visible(item: ChatLogItem): boolean {
    if (item.kind === "error") return true;
    return chatVisible(item.entry, {
      me: this.game.myPlayer(),
      sender: this.game.playerByClientID(item.entry.fromClientID),
      isRoot: chatState.isRoot,
    });
  }

  private async report(messageId: number) {
    if (await showInGameConfirm(translateText("chat.report_confirm"))) {
      this.eventBus.emit(new ReportChatEvent(messageId));
    }
  }

  init() {
    chatState.subscribe(() => this.syncChat());
    this.syncChat();
  }

  // Lists the server's chat lines in this same table; a reset or a history
  // replay (last seen line gone) rebuilds them.
  private syncChat() {
    const log = chatState.log();
    // A mute change rebuilds every line.
    const rebuild = chatState.version !== this.lastVersion;
    this.lastVersion = chatState.version;
    const at =
      this.lastChatItem && !rebuild ? log.indexOf(this.lastChatItem) : -1;
    const fresh = (at >= 0 ? log.slice(at + 1) : log).filter((i) =>
      this.visible(i),
    );
    const base =
      at >= 0 ? this.chatEvents : this.chatEvents.filter((e) => !e.chat);
    this.lastChatItem = log[log.length - 1];
    if (fresh.length === 0 && at >= 0) return;
    this.chatEvents = [
      ...base,
      ...fresh.map((chat) => ({
        description: "",
        chat,
        createdAt: this.game.ticks(),
      })),
    ];
    if (fresh.length > 0) {
      this.active = true;
      if (this._hidden) this.newEvents += fresh.length;
    }
    this.requestUpdate();
  }

  private renderChat(item: ChatLogItem) {
    if (item.kind === "error") {
      return html`<span class="text-red-400"
        >${translateText(`chat.error_${item.reason}`)}</span
      >`;
    }
    const e = item.entry;
    const sender = this.game.playerByClientID(e.fromClientID);
    const name = sender?.displayName() ?? translateText("chat.spectator");
    const mine = e.fromClientID === this.game.myPlayer()?.clientID();
    const actions =
      e.system || mine
        ? ""
        : html`<button
              data-chat-action="report"
              class="pointer-events-auto ml-2 text-xs text-zinc-300 underline hover:text-white"
              @click=${() => this.report(e.id)}
            >
              ${translateText("chat.report")}</button
            >${sender
              ? html`<button
                  data-chat-action="mute"
                  class="pointer-events-auto ml-2 text-xs text-zinc-300 underline hover:text-white"
                  @click=${() => chatState.mute(sender.displayName())}
                >
                  ${translateText("chat.mute")}
                </button>`
              : ""}`;
    return html`<span
        class="inline-flex items-center rounded-full px-2 py-0.5 text-[14px] font-bold text-white"
        >${translateText(`chat.channel_${e.channel}`)}</span
      >
      ${e.root ? rootBadge() : ""}
      <span class="font-semibold">${name}</span>: ${e.text}${actions}`;
  }

  tick() {
    // this.active = true;
    const updates = this.game.updatesSinceLastTick();
    if (updates === null) return;
    const messages = updates[GameUpdateType.DisplayEvent] as
      | DisplayMessageUpdate[]
      | undefined;

    if (messages) {
      for (const msg of messages) {
        if (msg.messageType === MessageType.CHAT) {
          const myPlayer = this.game.myPlayer();
          if (
            msg.playerID !== null &&
            (!myPlayer || myPlayer.smallID() !== msg.playerID)
          ) {
            continue;
          }

          this.chatEvents = [
            ...this.chatEvents,
            {
              description: msg.message,
              unsafeDescription: true,
              createdAt: this.game.ticks(),
            },
          ];
        }
      }
    }

    if (this.chatEvents.length > 100) {
      this.chatEvents = this.chatEvents.slice(-100);
    }

    this.requestUpdate();
  }

  private getChatContent(
    chat: ChatEvent,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return chat.unsafeDescription
      ? unsafeHTML(onlyImages(chat.description))
      : chat.description;
  }

  render() {
    if (!this.active) {
      return html``;
    }
    return html`
      <div
        class="pointer-events-auto ${this._hidden
          ? "w-fit px-2.5 py-1.25"
          : ""} rounded-md bg-black/60 relative max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw] lg:w-full lg:w-auto"
      >
        <div>
          <div class="w-full bg-black/80 sticky top-0 px-2.5">
            <button
              class="text-white cursor-pointer pointer-events-auto ${this
                ._hidden
                ? "hidden"
                : ""}"
              @click=${this.toggleHidden}
            >
              Hide
            </button>
            ${chatState.mutedCount() > 0
              ? html`<button
                  data-chat-action="unmute_all"
                  class="ml-2 text-xs text-zinc-300 underline hover:text-white cursor-pointer pointer-events-auto ${this
                    ._hidden
                    ? "hidden"
                    : ""}"
                  @click=${() => chatState.unmuteAll()}
                >
                  ${translateText("chat.unmute_all")}
                </button>`
              : ""}
          </div>

          <button
            class="text-white cursor-pointer pointer-events-auto ${this._hidden
              ? ""
              : "hidden"}"
            @click=${this.toggleHidden}
          >
            Chat
            <span
              class="${this.newEvents
                ? ""
                : "hidden"} inline-block px-2 bg-red-500 rounded-xs"
              >${this.newEvents}</span
            >
          </button>

          <table
            class="w-full border-collapse text-white shadow-lg lg:text-xl text-xs pointer-events-none ${this
              ._hidden
              ? "hidden"
              : ""}"
          >
            <tbody>
              ${this.chatEvents.map(
                (chat) => html`
                  <tr class="border-b border-gray-200/0">
                    <td class="lg:p-3 p-1 text-left">
                      ${chat.chat
                        ? this.renderChat(chat.chat)
                        : this.getChatContent(chat)}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
