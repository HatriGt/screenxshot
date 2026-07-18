// Normalize a Tauri capability `permissions` array to a flat list of string
// identifiers. Entries can be EITHER a bare string ("core:default") OR an
// object with an `identifier` field (e.g. the scoped opener permission
// `{ identifier: "opener:allow-open-url", allow: [...] }`). Rendering the raw
// object as a React child throws, so the Privacy panel must map through this.
// Pure + DOM-free so it's unit-testable.

/** A permission entry as it appears in capabilities/default.json. */
export type PermissionEntry = string | { identifier?: unknown };

/** Reduce mixed string/object permission entries to their string identifiers. */
export function permissionIdentifiers(permissions: readonly PermissionEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of permissions) {
    if (typeof entry === "string") {
      ids.push(entry);
    } else if (
      entry &&
      typeof entry === "object" &&
      typeof entry.identifier === "string"
    ) {
      ids.push(entry.identifier);
    }
  }
  return ids;
}

/** Identifiers that grant network/HTTP access — none is what makes the
 * "screenshots never leave the device" claim auditable. */
export function networkPermissions(identifiers: readonly string[]): string[] {
  return identifiers.filter((p) => /(^|:)(http|network)/i.test(p));
}
