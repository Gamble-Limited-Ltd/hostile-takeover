import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  AdminResult,
  banUser,
  ChatReport,
  deleteChatReport,
  getSiteStatus,
  listChatReports,
  markGameUnranked,
  muteUser,
  putSiteStatus,
  unbanUser,
  unmuteUser,
} from "../../AdminApi";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

// Same input styling as <password-auth-form> and AdminResetCard.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";

const KNOWN_ERRORS = [
  "forbidden",
  "no_such_user",
  "not_found",
  "protected_account",
  "unauthorized",
];
const errorKey = (code: string) =>
  KNOWN_ERRORS.includes(code)
    ? `admin.moderation.error_${code}`
    : "admin.moderation.error_generic";

type Section = "ban" | "mute" | "site" | "reports" | "unranked";

/**
 * Admin moderation card for the signed-in account panel: root only. Bans,
 * mutes, banner and maintenance, chat reports and unranking a game. Hiding the
 * card for other roles is cosmetic; the API checks.
 */
@customElement("admin-moderation-card")
export class AdminModerationCard extends LitElement {
  @state() private isRoot = false;
  @state() private busy = false;
  @state() private msg: {
    section: Section;
    error: boolean;
    text: string;
  } | null = null;
  @state() private banner = "";
  @state() private maintenance = false;
  @state() private reports: ChatReport[] = [];

  private f = {
    banUser: "",
    banMinutes: "",
    banReason: "",
    muteUser: "",
    muteMinutes: "",
    shadow: false,
    gameId: "",
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.init();
  }

  private async init(): Promise<void> {
    const auth = await userAuth();
    this.isRoot = auth !== false && auth.claims.role === "root";
    if (!this.isRoot) return;
    const status = await getSiteStatus();
    if (status.ok) {
      this.banner = status.data.banner ?? "";
      this.maintenance = status.data.maintenance;
    }
    await this.loadReports();
  }

  private async loadReports(): Promise<void> {
    const r = await listChatReports();
    if (r.ok) this.reports = r.data.reports;
  }

  private async run(
    section: Section,
    action: () => Promise<AdminResult>,
    done: string,
  ): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.msg = null;
    const r = await action();
    this.busy = false;
    this.msg = r.ok
      ? { section, error: false, text: translateText(done) }
      : { section, error: true, text: translateText(errorKey(r.code)) };
    return r.ok;
  }

  private minutes(raw: string): number | null | undefined {
    const t = raw.trim();
    if (t === "") return null;
    return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : undefined;
  }

  private ban = (e: Event) => {
    e.preventDefault();
    const minutes = this.minutes(this.f.banMinutes);
    if (!this.f.banUser.trim() || minutes === undefined) {
      this.msg = {
        section: "ban",
        error: true,
        text: translateText("admin.moderation.error_input"),
      };
      return;
    }
    void this.run(
      "ban",
      () => banUser(this.f.banUser, minutes, this.f.banReason.trim() || null),
      "admin.moderation.done_ban",
    );
  };

  private unban = () =>
    this.f.banUser.trim() &&
    void this.run(
      "ban",
      () => unbanUser(this.f.banUser),
      "admin.moderation.done_unban",
    );

  private mute = (e: Event) => {
    e.preventDefault();
    const minutes = this.minutes(this.f.muteMinutes);
    if (!this.f.muteUser.trim() || !minutes) {
      this.msg = {
        section: "mute",
        error: true,
        text: translateText("admin.moderation.error_input"),
      };
      return;
    }
    void this.run(
      "mute",
      () => muteUser(this.f.muteUser, minutes, this.f.shadow),
      "admin.moderation.done_mute",
    );
  };

  private unmute = () =>
    this.f.muteUser.trim() &&
    void this.run(
      "mute",
      () => unmuteUser(this.f.muteUser),
      "admin.moderation.done_unmute",
    );

  private saveSite = (e: Event) => {
    e.preventDefault();
    void this.run(
      "site",
      () =>
        putSiteStatus({
          banner: this.banner.trim() || null,
          maintenance: this.maintenance,
        }),
      "admin.moderation.done_site",
    );
  };

  private unrank = (e: Event) => {
    e.preventDefault();
    if (!this.f.gameId.trim()) return;
    void this.run(
      "unranked",
      () => markGameUnranked(this.f.gameId),
      "admin.moderation.done_unranked",
    );
  };

  private async removeReport(id: string): Promise<void> {
    const ok = await this.run(
      "reports",
      () => deleteChatReport(id),
      "admin.moderation.done_report",
    );
    if (ok) this.reports = this.reports.filter((r) => r.id !== id);
  }

  private input(name: keyof AdminModerationCard["f"], label: string) {
    return html`<input
      type="text"
      name=${name}
      autocomplete="off"
      @input=${(e: Event) => {
        (this.f[name] as string) = (e.target as HTMLInputElement).value;
      }}
      placeholder=${translateText(label)}
      aria-label=${translateText(label)}
      class=${INPUT_CLASS}
    />`;
  }

  private feedback(section: Section) {
    if (this.msg?.section !== section) return nothing;
    return this.msg.error
      ? html`<p class="text-sm text-red-200" role="alert">${this.msg.text}</p>`
      : html`<p class="text-white/50 text-sm" role="status">
          ${this.msg.text}
        </p>`;
  }

  private head(title: string, desc: string) {
    return html`<div>
      <div class="text-white font-medium">${translateText(title)}</div>
      <div class="text-white/50 text-sm mt-1">${translateText(desc)}</div>
    </div>`;
  }

  render() {
    if (!this.isRoot) return nothing;
    const box = "bg-white/5 rounded-xl border border-white/10 p-6 mt-4";
    return html`
      <div class=${box}>
        <form class="space-y-3" novalidate name="ban" @submit=${this.ban}>
          ${this.head(
            "admin.moderation.ban_title",
            "admin.moderation.ban_desc",
          )}
          ${this.input("banUser", "password_auth.admin_username")}
          ${this.input("banMinutes", "admin.moderation.minutes_permanent")}
          ${this.input("banReason", "admin.moderation.reason")}
          ${this.feedback("ban")}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="admin.moderation.ban_button"
          ></o-button>
          <o-button
            class="unban"
            variant="secondary"
            width="block"
            size="md"
            ?disable=${this.busy}
            translationKey="admin.moderation.unban_button"
            @click=${this.unban}
          ></o-button>
        </form>
      </div>
      <div class=${box}>
        <form class="space-y-3" novalidate name="mute" @submit=${this.mute}>
          ${this.head(
            "admin.moderation.mute_title",
            "admin.moderation.mute_desc",
          )}
          ${this.input("muteUser", "password_auth.admin_username")}
          ${this.input("muteMinutes", "admin.moderation.minutes")}
          <label class="flex items-center gap-2 text-white/70 text-sm">
            <input
              type="checkbox"
              name="shadow"
              @change=${(e: Event) => {
                this.f.shadow = (e.target as HTMLInputElement).checked;
              }}
            />
            ${translateText("admin.moderation.shadow")}
          </label>
          ${this.feedback("mute")}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="admin.moderation.mute_button"
          ></o-button>
          <o-button
            class="unmute"
            variant="secondary"
            width="block"
            size="md"
            ?disable=${this.busy}
            translationKey="admin.moderation.unmute_button"
            @click=${this.unmute}
          ></o-button>
        </form>
      </div>
      <div class=${box}>
        <form class="space-y-3" novalidate name="site" @submit=${this.saveSite}>
          ${this.head(
            "admin.moderation.site_title",
            "admin.moderation.site_desc",
          )}
          <input
            type="text"
            name="banner"
            autocomplete="off"
            .value=${this.banner}
            @input=${(e: Event) => {
              this.banner = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("admin.moderation.banner")}
            aria-label=${translateText("admin.moderation.banner")}
            class=${INPUT_CLASS}
          />
          <label class="flex items-center gap-2 text-white/70 text-sm">
            <input
              type="checkbox"
              name="maintenance"
              .checked=${this.maintenance}
              @change=${(e: Event) => {
                this.maintenance = (e.target as HTMLInputElement).checked;
              }}
            />
            ${translateText("admin.moderation.maintenance")}
          </label>
          ${this.feedback("site")}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="admin.moderation.site_button"
          ></o-button>
        </form>
      </div>
      <div class=${box}>
        <div class="space-y-3">
          ${this.head(
            "admin.moderation.reports_title",
            "admin.moderation.reports_desc",
          )}
          ${this.reports.length === 0
            ? html`<p class="text-white/50 text-sm">
                ${translateText("admin.moderation.reports_empty")}
              </p>`
            : this.reports.map(
                (r) => html`<div
                  class="report flex items-start gap-3 text-sm text-white/70"
                >
                  <span class="flex-1 break-words">
                    ${r.reporter ?? "?"} &rarr; ${r.target ?? "?"}
                    (${r.gameId}): ${r.message}
                  </span>
                  <o-button
                    class="delete-report"
                    variant="secondary"
                    size="md"
                    ?disable=${this.busy}
                    translationKey="admin.moderation.report_delete"
                    @click=${() => void this.removeReport(r.id)}
                  ></o-button>
                </div>`,
              )}
          ${this.feedback("reports")}
        </div>
      </div>
      <div class=${box}>
        <form
          class="space-y-3"
          novalidate
          name="unranked"
          @submit=${this.unrank}
        >
          ${this.head(
            "admin.moderation.unranked_title",
            "admin.moderation.unranked_desc",
          )}
          ${this.input("gameId", "admin.moderation.game_id")}
          ${this.feedback("unranked")}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="admin.moderation.unranked_button"
          ></o-button>
        </form>
      </div>
    `;
  }
}
