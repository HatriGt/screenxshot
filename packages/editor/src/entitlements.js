// Entitlement seam (U8). ScreenXShot ships 100% free today, so this returns the
// `pro` tier everywhere. This is the SINGLE place to later read a real license
// (file, keychain, or licensing service) when a paywall is introduced — route
// all future gated features through getEntitlements()/isPro() instead of
// scattering tier checks across the codebase.

/** @typedef {"free" | "pro"} Tier */

/** @returns {{ tier: Tier }} */
export function getEntitlements() {
  return { tier: "pro" };
}

/** @returns {boolean} */
export function isPro() {
  return getEntitlements().tier === "pro";
}
