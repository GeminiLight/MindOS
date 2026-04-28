# E2E Tests

Browser-based end-to-end tests using Playwright.

## Prerequisites

```bash
cd packages/web && npx playwright install
```

## Running

```bash
# Start the dev server first
npm run dev

# Run E2E tests
npx playwright test --config tests/e2e/playwright.config.ts
```

## Writing tests

- Each test file should cover a user-facing workflow (e.g. file navigation, search, settings)
- Use `test.describe` to group related scenarios
- Screenshots on failure are saved to `tests/e2e/results/`
