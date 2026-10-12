/**
 * Hostile Takeover feature switches.
 *
 * One frozen object of booleans, all off. Each switch gates the *entry points*
 * of a feature (nav items, buttons, menu rows, URL routes). The feature's
 * modules stay in the tree and stay loadable so upstream merges stay cheap;
 * flipping a switch to `true` brings its entry points back.
 *
 * Add new switches here (Slice 3.5: xp, ranked, clans, friends, ...) rather
 * than scattering ad-hoc `hidden` attributes. Keep every default `false`.
 */
export const Features = Object.freeze({
  /**
   * The store: STORE nav item and its notification dot, `#modal=store`,
   * `#modal=subscription` and `#affiliate=` routes, the subscription menu
   * row, and the purchase promo in the win box. Stripe loads only from the
   * store's purchase flow, so with this off it never loads.
   */
  store: false,
  /**
   * Paid-cosmetic UI: the Skins, Crowns and Effects categories in the
   * inventory, plus loadouts and "unequip all". Country flags are not
   * cosmetics in this sense (they ship with the game), so the inventory, and
   * its Flags category, stay reachable with this off.
   */
  cosmetics: false,
});
