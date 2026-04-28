# Integration Tests

Cross-service tests that verify the MCP server correctly communicates with the App REST API.

## Prerequisites

```bash
pnpm --filter @mindos/mcp-server build
```

## Running

```bash
# Start the app server first
npm run dev

# Run integration tests (requires app to be running)
npx vitest run --config tests/integration/vitest.config.ts
```

## Writing tests

- Tests should verify the MCP → App API contract (request/response shapes)
- Each MCP tool should have at least one integration test
- Use a temporary MIND_ROOT directory to avoid polluting real data
