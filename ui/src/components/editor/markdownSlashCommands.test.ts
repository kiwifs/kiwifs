import { describe, expect, it } from "vitest";
import {
  getAvailableMarkdownSlashCommands,
  markdownSlashCommands,
  replaceSlashCommandTrigger,
} from "./markdownSlashCommands";

function command(name: string) {
  const found = markdownSlashCommands.find((item) => item.name === name);
  if (!found) throw new Error(`Missing slash command: ${name}`);
  return found;
}

describe("markdown slash commands", () => {
  it("replaces the slash trigger line with a GFM table skeleton", () => {
    const doc = "# Note\n\n/ta";
    const result = replaceSlashCommandTrigger(doc, { from: 8, to: 11 }, command("table"));

    expect(result.doc).toBe("# Note\n\n| Column | Value |\n| --- | --- |\n|  |  |\n");
    expect(result.selection).toBe("# Note\n\n| Column | Value |\n| --- | --- |\n| ".length);
  });

  it("keeps surrounding text when inserting a todo item", () => {
    const doc = "Before\n/todo\nAfter";
    const result = replaceSlashCommandTrigger(doc, { from: 7, to: 12 }, command("todo"));

    expect(result.doc).toBe("Before\n- [ ] \nAfter");
    expect(result.selection).toBe("Before\n- [ ] ".length);
  });

  it("shows frontmatter when filtering slash commands for a document without frontmatter", () => {
    expect(getAvailableMarkdownSlashCommands("# Note\n\n", "fr").map((item) => item.name)).toContain("frontmatter");
  });

  it("hides frontmatter when filtering slash commands for a document that already has frontmatter", () => {
    const doc = "---\ntitle: Existing\n---\n\n/fr";

    expect(getAvailableMarkdownSlashCommands(doc, "fr").map((item) => item.name)).not.toContain("frontmatter");
  });

  it("assigns distinct emoji icons to slash command labels", () => {
    expect(command("table").icon).toBe("📊");
    expect(command("todo").icon).toBe("✅");
    expect(command("code").icon).toBe("💻");
    expect(command("quote").icon).toBe("💬");
    expect(command("frontmatter").icon).toBe("🧾");
    expect(command("quiz").icon).toBe("❓");
  });
});
