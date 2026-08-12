/**
 * sanitizeAttributes — keep `data-*` allow-lists surviving rehype-raw.
 *
 * `rehype-raw` re-parses the tree through parse5, and the hast that comes back
 * names attributes the way `property-information` does: `data-kiwi-directive`
 * becomes `dataKiwiDirective`, the same way `class` becomes `className`. A
 * schema that lists only the hyphenated spelling therefore matches nothing
 * once rehype-raw runs, and every directive marker is silently dropped —
 * markup renders as a bare `<div>` and the React component that keys off the
 * attribute never mounts.
 *
 * Listing both spellings is the fix. Deriving the second from the first means
 * a new `data-` attribute cannot be added in one spelling only.
 */

type AttributeEntry = string | [string, ...unknown[]];

function camelCaseDataAttribute(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Append the hast spelling of every `data-*` entry in one attribute list. */
export function withDataAttributeAliases<T extends AttributeEntry>(entries: T[]): (T | string)[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry === "string") seen.add(entry);
  }
  const aliases: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.startsWith("data-")) continue;
    const alias = camelCaseDataAttribute(entry);
    if (alias !== entry && !seen.has(alias)) {
      seen.add(alias);
      aliases.push(alias);
    }
  }
  return [...entries, ...aliases];
}

/** Apply {@link withDataAttributeAliases} to every list in a sanitize schema. */
export function withDataAttributeAliasesForSchema<T extends Record<string, AttributeEntry[] | undefined>>(
  attributes: T,
): T {
  const out: Record<string, AttributeEntry[] | undefined> = {};
  for (const [tag, entries] of Object.entries(attributes)) {
    out[tag] = entries ? withDataAttributeAliases(entries) : entries;
  }
  return out as T;
}
