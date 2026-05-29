# Schema — Team Wiki

Flat, workflow-oriented wiki for teams replacing Confluence or Notion.
Organized around how work gets done, not org charts. Max 3 levels deep.

## Directory Structure

    welcome.md           Orientation — what this wiki is, how to contribute
    how-we-work.md       Communication norms, meetings, decision-making
    architecture.md      System overview, components, data flow
    onboarding/          New member checklist and resources
      index.md           Landing page with week-1 and week-2 checklists
    decisions/           Architecture Decision Records
      index.md           Decision log and ADR format guide
      adr-NNN-slug.md    Individual decisions
    processes/           Standard operating procedures
      index.md           Process index
      deployment.md      How to deploy
      dev-setup.md       Local environment setup
      incident-response.md  What to do when production breaks
    reference/           Shared resources and terminology
      index.md           Reference landing page
      glossary.md        Team vocabulary
      faq.md             Frequently asked questions
    index.md             Wiki-wide table of contents
    SCHEMA.md            This file — structure and conventions

## Frontmatter Fields

Every `.md` file should have YAML frontmatter. Required fields marked *.

| Field           | Type       | Required | Values / Notes                              |
|-----------------|------------|----------|---------------------------------------------|
| title           | string     | *        | Human-readable page title                   |
| owner           | string     | *        | Team or person responsible for this page     |
| status          | string     | *        | `draft` · `active` · `review` · `deprecated` |
| tags            | string[]   | *        | Topic tags, lowercase, hyphenated           |
| last-reviewed   | date       |          | ISO 8601 date of last quality review        |

### Additional fields for ADRs (`decisions/adr-*.md`)

| Field              | Type       | Required | Values / Notes                           |
|--------------------|------------|----------|------------------------------------------|
| type               | string     | *        | Always `decision`                        |
| date               | date       | *        | Date the decision was made               |
| decision           | string     | *        | One-line summary of the decision         |
| alternatives       | object[]   |          | Each: `option`, `pros`, `cons`           |
| impact             | string     |          | What this decision affects               |
| reversal-conditions| string     |          | When to revisit this decision            |
| linked-docs        | string[]   |          | Related wiki pages                       |

## Conventions

- **Workflow-first structure.** Sections map to how work gets done.
- **Max 3 levels deep.** If it needs more nesting, split into a new section.
- **Every folder has `index.md`.** The landing page for that area.
- **Link between pages** with `[[wiki links]]`.
- **Keep pages short.** Split when a page exceeds ~300 lines.
- **Descriptive titles.** "Deployment Process" not "Ship It Guide".
- **Tags are lowercase, hyphenated.** `ci-cd`, `team-norms`, `api-design`.
- **Owner accountability.** Every page has an owner who reviews it periodically.

## Operations

See `.kiwi/playbook.md` for MCP tool sequences.
