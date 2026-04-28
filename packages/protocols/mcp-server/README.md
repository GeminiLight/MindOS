# @mindos/mcp-server

MCP server source package for MindOS.

This package is the v1 source of truth for MCP server code. Build it with:

```bash
pnpm --filter @mindos/mcp-server build
```

The built runtime is `dist/index.cjs`. Desktop and npm packaging consume this package layout directly through `packages/protocols/mcp-server/dist/index.cjs`; source changes belong here.
