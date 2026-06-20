---
title: "Server Won't Start"
type: troubleshooting
owner: team-lead
status: verified
tags: [troubleshooting, server, startup]
verified_at: 2026-01-01
review_interval: 60
severity: medium
---

# Server Won't Start

## Symptom

Running `kiwifs serve` exits immediately with no output, or shows
"address already in use" error.

## Possible Causes

1. **Port already in use** — Another process is bound to port 3333.
2. **Missing root directory** — The `--root` path doesn't exist.
3. **Permission denied** — No read access to the workspace directory.

## Solutions

### Port already in use

Check what's using the port and stop it:

```bash
lsof -ti:3333 | xargs kill -9
kiwifs serve --root ./my-kb
```

Or start on a different port:

```bash
kiwifs serve --root ./my-kb --port 3334
```

### Missing root directory

Ensure the path exists and contains a `.kiwi/` folder:

```bash
ls -la ./my-kb/.kiwi/
```

If missing, reinitialize:

```bash
kiwifs init --root ./my-kb --template kb
```

### Permission denied

Check file permissions:

```bash
ls -la ./my-kb/
chmod -R 755 ./my-kb/
```

## Escalation

If none of the above resolves the issue, check the server logs:

```bash
kiwifs serve --root ./my-kb --log-level debug
```

File an issue with the debug output attached.
