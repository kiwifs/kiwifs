export type KanbanBlockCard = {
  id: string;
  title: string;
  tags?: string[];
  description?: string;
  priority?: string;
  assignee?: string;
};

export type KanbanBlockColumn = {
  name: string;
  color?: string;
  cards: KanbanBlockCard[];
};

export type KanbanBlockExportConfig = {
  format?: "markdown" | "json";
  copyLabel?: string;
};

export type KanbanBlockConfig = {
  title?: string;
  columns: KanbanBlockColumn[];
  export?: KanbanBlockExportConfig;
  /**
   * A DQL query whose result rows become the cards. Requires `groupBy` to say
   * which column decides the lane; without it the board cannot be built and
   * the inline `columns` are used instead.
   */
  query?: string;
  /** Result column whose value places a card in a lane, e.g. `status`. */
  groupBy?: string;
};

type ParserSection = "root" | "columns" | "column" | "cards" | "card" | "export";

export function parseKanbanBlockConfig(source: string): KanbanBlockConfig {
  const trimmed = source.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as KanbanBlockConfig;
  }

  let title: string | undefined;
  let query: string | undefined;
  let groupBy: string | undefined;
  const exportConfig: KanbanBlockExportConfig = {};
  const columns: KanbanBlockColumn[] = [];
  const lines = trimmed.split("\n");
  let section: ParserSection = "root";
  let currentColumn: KanbanBlockColumn = { name: "", cards: [] };
  let currentCard: Partial<KanbanBlockCard> = {};

  // Pull the root-level `query:` / `groupBy:` keys out first. The main loop
  // below is a line-at-a-time state machine with no lookahead, so a `query: |`
  // block scalar has to be consumed here or its DQL lines would be
  // misinterpreted as card fields.
  const consumed = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.length - raw.trimStart().length !== 0) continue;
    const match = raw.trim().match(/^(query|groupBy):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue!.trim();
    consumed.add(i);

    if (key === "groupBy") {
      groupBy = stripYamlQuotes(value) || undefined;
      continue;
    }
    if (value === "|" || value === ">") {
      const body: string[] = [];
      let blockIndent = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]!;
        if (!line.trim()) {
          body.push("");
          consumed.add(j);
          continue;
        }
        const ind = line.length - line.trimStart().length;
        if (ind === 0) break;
        if (blockIndent === -1) blockIndent = ind;
        body.push(line.slice(Math.min(blockIndent, ind)));
        consumed.add(j);
      }
      while (body.length > 0 && body[body.length - 1] === "") body.pop();
      const text = body.join("\n");
      query = (value === "|" ? text : text.replace(/\s*\n\s*/g, " ").trim()) || undefined;
    } else {
      query = stripYamlQuotes(value) || undefined;
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    if (consumed.has(idx)) continue;
    const line = lines[idx]!;
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    if (l.startsWith("title:") && indent === 0) {
      title = stripYamlQuotes(l.slice(6).trim());
      section = "root";
    } else if (l === "export:" && indent === 0) {
      section = "export";
    } else if (section === "export") {
      const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        assignExportValue(exportConfig, key!, stripYamlQuotes(value!.trim()));
      }
      if (indent === 0 && l !== "export:") section = "root";
    } else if (l === "columns:" && indent === 0) {
      section = "columns";
    } else if (section === "columns" && l.startsWith("- name:")) {
      if (currentColumn.name) {
        if (currentCard.id) {
          currentColumn.cards.push(finalizeKanbanBlockCard(currentCard));
          currentCard = {};
        }
        columns.push(currentColumn);
      }
      currentColumn = { name: stripYamlQuotes(l.slice("- name:".length).trim()), cards: [] };
      section = "column";
    } else if (section === "column" && l.startsWith("color:")) {
      currentColumn.color = stripYamlQuotes(l.slice(6).trim());
    } else if ((section === "column" || section === "cards") && l === "cards:") {
      section = "cards";
    } else if (section === "cards" && l.startsWith("- id:")) {
      if (currentCard.id) {
        currentColumn.cards.push(finalizeKanbanBlockCard(currentCard));
      }
      currentCard = { id: stripYamlQuotes(l.slice("- id:".length).trim()) };
      section = "card";
    } else if (section === "card" || section === "cards") {
      const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
      if (kvMatch) {
        const [, key, rawValue] = kvMatch;
        const value = stripYamlQuotes(rawValue!.trim());
        assignCardValue(currentCard, key!, value);
      }

      if (l.startsWith("- name:")) {
        if (currentCard.id) {
          currentColumn.cards.push(finalizeKanbanBlockCard(currentCard));
          currentCard = {};
        }
        columns.push(currentColumn);
        currentColumn = { name: stripYamlQuotes(l.slice("- name:".length).trim()), cards: [] };
        section = "column";
      }
    }
  }

  if (currentCard.id) {
    currentColumn.cards.push(finalizeKanbanBlockCard(currentCard));
  }
  if (currentColumn.name) {
    columns.push(currentColumn);
  }

  return { title, columns, export: exportConfig, query, groupBy };
}

/**
 * queryRowsToKanbanColumns turns DQL result rows into lanes.
 *
 * Lanes declared inline win on order and colour; any group value the query
 * produces that no declared lane covers is appended in first-seen order, so a
 * new status showing up in the data is visible rather than silently dropped.
 * Rows with an empty group value are skipped — a lane named "" is not useful.
 */
export function queryRowsToKanbanColumns(
  rows: Record<string, unknown>[],
  groupBy: string,
  declared: KanbanBlockColumn[] = [],
): KanbanBlockColumn[] {
  const order: string[] = [];
  const byName = new Map<string, KanbanBlockColumn>();

  for (const col of declared) {
    if (byName.has(col.name)) continue;
    order.push(col.name);
    byName.set(col.name, { name: col.name, color: col.color, cards: [] });
  }

  for (const row of rows) {
    const rawGroup = row[groupBy];
    if (rawGroup == null) continue;
    const group = String(rawGroup).trim();
    if (!group) continue;

    if (!byName.has(group)) {
      order.push(group);
      byName.set(group, { name: group, cards: [] });
    }
    byName.get(group)!.cards.push(rowToKanbanCard(row));
  }

  return order.map((name) => byName.get(name)!);
}

function rowToKanbanCard(row: Record<string, unknown>): KanbanBlockCard {
  const path = typeof row._path === "string" ? row._path : undefined;
  const title = firstString(row, ["title", "name"]) ?? basename(path) ?? "Untitled";

  return {
    // The path is the only identifier guaranteed unique across a result set,
    // and dnd-kit needs stable ids to track a dragged card.
    id: path ?? `${title}-${JSON.stringify(row).length}`,
    title,
    tags: toTags(row.tags),
    description: firstString(row, ["description", "summary"]),
    priority: firstString(row, ["priority"]),
    assignee: firstString(row, ["assignee", "owner"]),
  };
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function basename(path?: string): string | undefined {
  if (!path) return undefined;
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.mdx?$/, "") || undefined;
}

function toTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const tags = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

export function buildKanbanBlockExportText(
  columns: KanbanBlockColumn[],
  format: KanbanBlockExportConfig["format"] = "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(
      columns.map((col) => ({
        column: col.name,
        cards: col.cards.map((card) => ({ id: card.id, title: card.title, tags: card.tags })),
      })),
      null,
      2,
    );
  }

  const parts: string[] = [];
  for (const col of columns) {
    parts.push(`## ${col.name}`);
    for (const card of col.cards) {
      const tagStr = card.tags?.length ? ` [${card.tags.join(", ")}]` : "";
      parts.push(`- **${card.title}**${tagStr}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

function finalizeKanbanBlockCard(raw: Partial<KanbanBlockCard>): KanbanBlockCard {
  return {
    id: raw.id || `card-${Math.random().toString(36).slice(2, 8)}`,
    title: raw.title || "Untitled",
    tags: raw.tags,
    description: raw.description,
    priority: raw.priority,
    assignee: raw.assignee,
  };
}

function assignExportValue(config: KanbanBlockExportConfig, key: string, value: string) {
  if (key === "format" && (value === "markdown" || value === "json")) {
    config.format = value;
  } else if (key === "copyLabel") {
    config.copyLabel = value;
  }
}

function assignCardValue(card: Partial<KanbanBlockCard>, key: string, value: string) {
  if (key === "title") card.title = value;
  else if (key === "description") card.description = value;
  else if (key === "priority") card.priority = value;
  else if (key === "assignee") card.assignee = value;
  else if (key === "tags" && value.startsWith("[") && value.endsWith("]")) {
    card.tags = value.slice(1, -1).split(",").map((s) => stripYamlQuotes(s.trim()));
  }
}

function stripYamlQuotes(value: string): string {
  // Only unwrap a matched pair. The previous alternation stripped a leading
  // OR a trailing quote independently, which silently truncated any value
  // that merely ends in one — `TABLE title FROM "x"` lost its final quote.
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}
