# Agent Playbook — CMS

This workspace is a git-based headless CMS. Content is authored as markdown
with structured frontmatter, then published via REST API or the public reader.

## Quick Start

1. Call `kiwi_context` to get this playbook + schema + index in one call
2. Call `kiwi_tree` to see the content structure
3. Use the operations below to create and publish content

## Content Types

| Type | Folder | Schema | Purpose |
|------|--------|--------|---------|
| `blog-post` | `blog/` | `.kiwi/schemas/blog-post.json` | Articles, announcements |
| `doc` | `docs/` | `.kiwi/schemas/doc.json` | Product documentation |
| `page` | `pages/` | `.kiwi/schemas/page.json` | Static pages |
| `author` | `authors/` | `.kiwi/schemas/author.json` | Author profiles |

## Create Content

1. **Choose the content type** and target folder.

2. **Write the file** with appropriate frontmatter:
   ```yaml
   ---
   title: "Post Title"
   slug: post-title
   type: blog-post
   author: "[[authors/your-name]]"
   category: updates
   tags: [topic-1, topic-2]
   published: false
   published_at: null
   meta_title: "Post Title | Site Name"
   meta_description: "One-line for search engines (150-160 chars)"
   ---
   ```

3. **Set the slug** — this becomes the URL path. Use lowercase,
   hyphenated, no special characters.

4. **Link to author** — use a wiki-link to the author profile.

5. **Cross-link** related content with `[[wikilinks]]`.

6. **Update the section index** — add entry to the folder's `index.md`.

## Publish Content

1. Set `published: true` in frontmatter.
2. Set `published_at` to the publication date (ISO format).
3. Advance the editorial workflow:
   ```
   kiwi_workflow_advance(path, "published", actor: "editor")
   ```
4. Content is now available at `/p/{path}`.

### Content Negotiation

Published pages at `GET /p/{path}` support:
- `Accept: text/html` → Server-rendered HTML (default)
- `Accept: text/markdown` → Raw markdown with frontmatter
- `Accept: application/json` → Structured payload with HTML + frontmatter

## SEO Checklist

For every published page:
- [ ] `meta_title` is unique and under 60 characters
- [ ] `meta_description` is under 160 characters and compelling
- [ ] `slug` is descriptive and stable (don't change after publish)
- [ ] Internal cross-links exist to related content
- [ ] Content is categorized and tagged

## Editorial Workflow

States: `draft` → `review` → `scheduled` → `published` → `archived`

- `draft` — Work in progress, not visible
- `review` — Ready for editorial review
- `scheduled` — Approved, waiting for `published_at` date
- `published` — Live and accessible via `/p/*`
- `archived` — Removed from public view, retained in git

## Maintain

1. `kiwi_analytics` — find broken links, orphan pages.
2. Check for `published: true` pages with outdated content.
3. Verify all author links resolve.
4. Ensure slugs are unique across the workspace.
