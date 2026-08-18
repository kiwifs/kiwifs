/**
 * Per-space browser state is keyed by space name. The primary space used to be
 * keyed under the alias "default" while the same space was keyed under its real
 * name whenever it was reached via an explicit URL — so one space could end up
 * with two sets of recents, stars and pins. Once the real name is known, fold
 * any "default" bucket into it.
 */

const SPACE_SCOPED_KEYS = [
  "kiwifs-recent-pages",
  "kiwifs-starred-pages",
  "kiwifs-pinned-pages",
] as const;

const LEGACY_ALIAS = "default";

export function migrateSpaceScopedKeys(primary: string): void {
  if (!primary || primary === LEGACY_ALIAS) return;
  for (const base of SPACE_SCOPED_KEYS) {
    const from = `${base}:${LEGACY_ALIAS}`;
    const to = `${base}:${primary}`;
    try {
      const value = localStorage.getItem(from);
      if (value === null) continue;
      if (localStorage.getItem(to) !== null) continue;
      localStorage.setItem(to, value);
      localStorage.removeItem(from);
    } catch {
      return;
    }
  }
}
