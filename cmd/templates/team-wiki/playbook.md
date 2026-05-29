# Agent Playbook — Team Wiki

This wiki is organized by workflow area, with each folder containing
an `index.md` landing page. When connected via MCP, use these
operations to maintain it.

## Quick Start

1. Call `kiwi_context` to get this playbook + schema + index in one call
2. Call `kiwi_tree` to see the current folder structure
3. Use the operations below to create, organize, and maintain

## Create Page

When adding new content:

1. **Find the right section.** `kiwi_tree` to see the area structure.
   - `processes/` — SOPs, runbooks, step-by-step guides
   - `decisions/` — ADRs (use the decision template)
   - `reference/` — glossary entries, FAQ, vendor info
   - `onboarding/` — new-member resources
   - Top-level — only for major cross-cutting pages
2. **Check for duplicates.** `kiwi_search` for key terms first.
3. **Write the page.** `kiwi_write` with frontmatter:
   ```yaml
   ---
   title: "Page Title"
   owner: team-or-person
   status: draft
   tags: [section, topic]
   last-reviewed: YYYY-MM-DD
   ---
   ```
4. **Cross-link.** Add `[[wikilinks]]` to related pages.
   Use `kiwi_search` to find them.
5. **Update the section index.** `kiwi_read` the section's `index.md`,
   add a link to the new page, `kiwi_write` it back.

### Create ADR

For decisions, follow these extra steps:

1. Determine the next ADR number from `decisions/index.md`.
2. Create `decisions/adr-NNN-slug.md` using the decision template.
3. Set `type: decision` and fill in `alternatives`, `impact`,
   `reversal-conditions`.
4. Add a row to the decision log in `decisions/index.md`.

## Organize

When restructuring or cleaning up:

1. `kiwi_tree` to understand current layout.
2. `kiwi_rename` to move pages — links auto-update.
3. Ensure every folder has an `index.md` landing page.
4. Keep folder depth ≤ 3 levels for discoverability.

## Maintain

Run periodically or when asked:

1. `kiwi_lint` with `path` — check individual files for structural issues.
2. `kiwi_analytics` — find stale pages, orphans, broken links.
3. For stale pages: update content, bump `last-reviewed`, notify owner.
4. For orphans: add links from related pages or the section index.
5. For broken links: `kiwi_search` for the intended target, fix.
6. `kiwi_search` for "TODO" or "TBD" to find incomplete pages.
7. Check for `status: draft` pages that should be promoted to `active`.

**Best practice:** After every `kiwi_write`, call `kiwi_lint` on the same path.

## Quality Rules

- **Workflow-first structure.** Sections map to how work gets done.
- **Every folder has `index.md`.** The landing page for that area.
- **Keep pages short.** Split when a page exceeds ~300 lines.
- **Frontmatter required.** At least `title`, `owner`, `status`, and `tags`.
- **No orphans.** Every page reachable from its section's `index.md`.
- **Owner accountability.** Stale pages get flagged to their owner.
- **Descriptive titles.** Plain language, no jargon or clever names.
