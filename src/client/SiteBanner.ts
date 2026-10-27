import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getApiBase } from "./ApiBase";
import { translateText } from "./Utils";

/**
 * Fork-only (S6): the admin's site banner and the maintenance notice on the
 * homepage. Markup and classes are AccountModal's red notice strip (the
 * closest existing notice). Renders nothing when there is nothing to say or
 * the API cannot be reached.
 */
@customElement("site-banner")
export class SiteBanner extends LitElement {
  @state() private banner: string | null = null;
  @state() private maintenance = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch(`${getApiBase()}/public/site-status`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        banner?: unknown;
        maintenance?: unknown;
      };
      this.banner =
        typeof body.banner === "string" && body.banner ? body.banner : null;
      this.maintenance = body.maintenance === true;
    } catch {
      // no banner when the API is unreachable
    }
  }

  render() {
    const lines = [
      this.maintenance ? translateText("site_banner.maintenance") : null,
      this.banner,
    ].filter((l): l is string => l !== null);
    if (lines.length === 0) return nothing;
    return html`
      <div
        class="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4"
        role="status"
      >
        <span class="text-red-400 text-lg leading-none" aria-hidden="true">
          &#9888;
        </span>
        <div class="flex-1 text-sm text-red-200">
          ${lines.map((l) => html`<p>${l}</p>`)}
        </div>
      </div>
    `;
  }
}
