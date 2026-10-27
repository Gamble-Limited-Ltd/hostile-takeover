import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, TemplateResult } from "lit";
import { translateText } from "../../Utils";

// Crown that marks Boss's root account next to a name (Boss override of strict
// UI rule 2, 2026-10-27). Callers gate on server-set data, never on names.
export function rootBadge(sizeClass = "w-4 h-4"): TemplateResult {
  const text = translateText("player_badge.root");
  return html`<img
    src=${assetUrl("images/CrownIcon.svg")}
    class="${sizeClass} inline-block shrink-0 object-contain"
    data-badge="root"
    alt=${text}
    title=${text}
  />`;
}
