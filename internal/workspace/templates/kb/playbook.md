# Agent Playbook — Knowledge Base

This knowledge base is curated and governed. Articles have owners,
verification workflows, and structured types. When connected via MCP,
use these operations to maintain it.

## Quick Start

1. Call `kiwi_context` to get this playbook + schema + index in one call
2. Call `kiwi_tree` to see the category structure
3. Use the operations below to create, verify, and maintain articles

## Create Article

When adding new content:

1. **Determine the article type.** Match content to type:
   - `how-to` — numbered steps for a task
   - `troubleshooting` — symptom → cause → solution
   - `faq` — direct answer (< 3 paragraphs)
   - `reference` — technical details, tables, definitions

2. **Choose the right category.** `kiwi_tree` to see the structure:
   - `getting-started/` — setup, onboarding, first-run
   - `guides/` — how-to articles
   - `troubleshooting/` — symptom-first problem resolution
   - `reference/` — specs, settings, glossary
   - `faq/` — frequently asked questions

3. **Check for duplicates.** `kiwi_search` for key terms first.

4. **Write the article.** `kiwi_write` with frontmatter:
   ```yaml
   ---
   title: "Article Title"
   type: how-to
   owner: author-name
   status: draft
   tags: [category, topic]
   verified_at: null
   review_interval: 90
   ---
   ```

5. **Follow the type structure:**
   - **How-to:** Prerequisites → Steps → Verification → Related
   - **Troubleshooting:** Symptom → Possible Causes → Solutions → Escalation
   - **FAQ:** Direct answer → Related links
   - **Reference:** Overview → Details table → Examples → Constraints

6. **Cross-link.** Add `[[wikilinks]]` to related articles.

7. **Update the category index.** Add a link to the category's `index.md`.

## Verify Article

When reviewing content for accuracy:

1. `kiwi_read` the article.
2. Check factual accuracy against source of truth.
3. Verify all links resolve (`kiwi_lint`).
4. Update `verified_at` to today's date.
5. Set `status: verified`.
6. `kiwi_workflow_advance` to move through the verification workflow.

## Maintain

Run periodically or when asked:

1. **Find stale articles:**
   ```
   kiwi_query("TABLE _path, title, owner, verified_at, review_interval WHERE status = 'verified' AND DAYS_AGO(verified_at) > review_interval SORT verified_at ASC")
   ```

2. **Find unverified drafts:**
   ```
   kiwi_query("TABLE _path, title, owner WHERE status = 'draft' SORT _created ASC")
   ```

3. `kiwi_analytics` — find orphans, broken links, stale content.

4. For stale articles: re-verify or flag to owner.

5. For orphans: add links from the category index.

6. `kiwi_lint` on individual files after edits.

## Search Gap Detection

Identify what users search for but can't find:

1. Check search analytics for no-result queries.
2. Group related no-result queries by theme.
3. Create new articles in draft for the top gaps.
4. Notify the appropriate owner for verification.

## Quality Rules

- **One topic per article.** Split articles over 300 lines.
- **Every article has frontmatter** with `title`, `type`, `owner`, `status`, `tags`, `verified_at`, `review_interval`.
- **Article type determines structure.** Don't mix types in one page.
- **No orphans.** Every article linked from its category `index.md`.
- **Freshness enforced.** Articles past `review_interval` days get flagged.
- **Owner accountability.** Stale articles are the owner's responsibility.
- **Titles match search intent.** Use the words users actually search for.
- **Lint after every write.** `kiwi_lint` catches structural issues.
