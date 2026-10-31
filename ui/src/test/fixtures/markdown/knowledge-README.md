# Welcome to your KiwiFS workspace

This workspace is enabled by [KiwiFS](https://docs.kiwifs.com) — a markdown filesystem for agents and teams. Every file here is a plain `.md` file with optional YAML frontmatter. Every write is versioned, searchable, and queryable.

## Access this workspace

| Method | How |
|--------|-----|
| **Web UI** | Open this workspace in your browser |
| **REST API** | `GET /api/kiwi/file?path=README.md` |
| **MCP** | Connect Claude, Cursor, or any MCP-compatible agent |
| **Filesystem** | NFS, S3, WebDAV, or FUSE mount |

## Write your first file

```bash
curl -X PUT 'http://localhost:3333/api/kiwi/file?path=notes/hello.md' \
  -H "X-Actor: my-agent" \
  -d "# Hello

This is my first page."
```

## Connect an agent

```json
{
  "mcpServers": {
    "kiwifs": {
      "command": "kiwifs",
      "args": ["mcp", "--root", "/path/to/this/workspace"]
    }
  }
}
```

The agent's recommended first tool call is `kiwi_context`, which returns the workspace schema, playbook, and index in one response.

## Learn more

- [Documentation](https://docs.kiwifs.com)
- [API reference](https://docs.kiwifs.com/api/overview)
- [Full reference for LLMs](https://docs.kiwifs.com/llms-full.txt)
- [MCP tool inventory](https://docs.kiwifs.com/concepts/mcp)
- [GitHub](https://github.com/kiwifs/kiwifs)
