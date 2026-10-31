---
title: "How to Create a New Article"
type: how-to
owner: team-lead
status: verified
tags: [guides, content-creation]
verified_at: 2026-01-01
review_interval: 90
estimated_time: "3 minutes"
---

# How to Create a New Article

Add a new article to the knowledge base with proper structure and metadata.

## Prerequisites

- Write access to the workspace
- Understanding of which article type fits your content

## Steps

1. **Determine the article type.** Choose from:
   - `how-to` — task completion with numbered steps
   - `troubleshooting` — symptom-first problem resolution
   - `faq` — direct answer to a question (< 3 paragraphs)
   - `reference` — technical details, settings, definitions

2. **Choose the right category.** Place the file in the appropriate folder:
   - `getting-started/` — setup and onboarding
   - `guides/` — how-to articles
   - `troubleshooting/` — problem resolution
   - `reference/` — technical reference
   - `faq/` — frequently asked questions

3. **Create the file** with frontmatter matching the article type schema:
   ```yaml
   ---
   title: "Your Article Title"
   type: how-to
   owner: your-name
   status: draft
   tags: [category, topic]
   verified_at: null
   review_interval: 90
   ---
   ```

4. **Write the body** following the structure for your article type.

5. **Submit for review.** Set `status: review` when ready for verification.

## Verification

- Article appears in the sidebar under its category
- `kiwifs check` passes without errors for the new file
- Frontmatter validates against the article type schema

## Related

- [[../reference/index|Reference]] — Article type schemas and field definitions
