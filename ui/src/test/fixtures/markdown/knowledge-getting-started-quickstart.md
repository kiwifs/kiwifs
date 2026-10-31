---
title: Quickstart
type: how-to
owner: team-lead
status: verified
tags: [getting-started, setup]
verified_at: 2026-01-01
review_interval: 60
estimated_time: "5 minutes"
---

# Quickstart

Get up and running in under 5 minutes.

## Prerequisites

- A terminal with `kiwifs` installed
- Basic familiarity with markdown

## Steps

1. **Initialize a workspace.**
   ```bash
   kiwifs init --root ./my-kb --template kb
   ```

2. **Start the server.**
   ```bash
   kiwifs serve --root ./my-kb
   ```

3. **Open the UI.** Navigate to `http://localhost:3333` in your browser.

4. **Create your first article.** Click "New Page" and choose a template
   (how-to, troubleshooting, FAQ, or reference).

5. **Connect an agent.** Use `kiwifs connect` or configure MCP in your
   editor to let AI agents query and maintain the KB.

## Verification

- The UI loads at `http://localhost:3333`
- You can see the category navigation in the sidebar
- Search returns results from the example articles

## Next Steps

- [[guides/index|Browse guides]] for specific tasks
- Read the [[reference/index|Reference]] for configuration details
