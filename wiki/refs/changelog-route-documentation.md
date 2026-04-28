# Changelog Route Documentation

> **Added**: 2026-04-10  
> **Status**: ✅ Live  
> **Related Commit**: `99127caf` — Add /changelog route with redirect from /changes

## Overview

MindOS provides **two routes** for accessing changelog and content change tracking:

| Route | Purpose | Handler | Behavior |
|-------|---------|---------|----------|
| `/changelog` | Primary changelog page | `app/changelog/page.tsx` | Server component → Client render |
| `/changes` | Backward compatibility | `app/changes/page.tsx` | Redirect to `/changelog` |

## Route Details

### `/changelog` — Primary Changelog Page

**Files:**
- `app/app/changelog/page.tsx` (server component)
- `app/app/changelog/ChangelogClient.tsx` (client component)
- `components/renderers/change-log/ChangeLogRenderer.tsx` (UI renderer)

**Behavior:**
1. Server component checks user setup status (redirects to setup if not configured)
2. Renders `ChangelogClient` with changelog data
3. Client component handles sorting, filtering, search
4. `ChangeLogRenderer` renders individual change entries

**Data Source:**
- Reads from `~/.mindos/change-log.json`
- Contains timestamped changelog entries (version, date, features, fixes, breaking changes)

**Features:**
- Full-text search
- Version filtering
- Date range selection
- Copy-to-clipboard entries
- i18n support (EN/ZH)

### `/changes` — Redirect Route

**File:**
- `app/app/changes/page.tsx` (redirect handler)

**Behavior:**
```typescript
export default function ChangesPage() {
  redirect('/changelog');
}
```

Uses Next.js `redirect()` to permanently forward `/changes` → `/changelog`.

**Why?**
- **Backward compatibility**: Legacy links/bookmarks still work
- **User preference**: `/changelog` is more SEO-friendly
- **Naming clarity**: "changelog" is standard industry term

## API Backend: `/api/changes`

Route handler: `app/app/api/changes/route.ts`

### Operations

#### 1. GET `/api/changes?op=summary`
Returns high-level change summary.

```typescript
Response:
{
  success: true,
  data: {
    totalChanges: number,
    dateRange: { from: timestamp, to: timestamp },
    latestVersion: string,
    categories: { feature: number, fix: number, breaking: number }
  }
}
```

#### 2. GET `/api/changes?op=list&...`
Lists content changes with filtering.

**Query Parameters:**
- `op=list` (required)
- `path?` (string) — filter by file path (substring match)
- `source?` (string) — filter by source ('user' | 'agent' | 'system')
- `operation?` (string) — filter by operation ('create' | 'edit' | 'delete' | 'rename')
- `search?` (string) — search in content/path
- `limit?` (number) — max results (default: 100)
- `since?` (timestamp) — changes since this time
- `until?` (timestamp) — changes until this time

```typescript
Response:
{
  success: true,
  data: [
    {
      id: string,
      path: string,
      operation: 'create' | 'edit' | 'delete' | 'rename',
      source: 'user' | 'agent' | 'system',
      timestamp: number,
      content?: string,  // preview
      metadata: {
        size?: number,
        lines?: number,
        author?: string
      }
    }
  ],
  pagination: {
    total: number,
    limit: number,
    offset: number
  }
}
```

#### 3. POST `/api/changes?op=mark_seen`
Mark changes as "read" (hide from recent changes).

```typescript
Request:
{
  changeIds: string[],
  markAllAsSeen?: boolean
}

Response:
{
  success: true,
  marked: number
}
```

## Integration Points

### Navigation
- **App Menu**: Often linked from footer or settings
- **Activity Bar**: May have "View Changes" button
- **Recent Activity Widget**: Links to specific changes

### Frontend Components
- **HomeDashboard**: Shows recent changes widget
- **SettingsPanel**: Links to `/changelog` for release notes
- **OnboardingFlow**: May reference changelog for feature discovery

## Changelog Data Format

**File**: `~/.mindos/change-log.json`

```json
{
  "releases": [
    {
      "version": "0.6.65",
      "releaseDate": "2026-04-10",
      "features": [
        "Save Session with AI digest",
        "Ask Panel UX improvements",
        "IM integration for 8 platforms"
      ],
      "fixes": [
        "Fixed icon color flash in Daily Echo",
        "Improved Ask panel navigation sync"
      ],
      "breaking": [
        "Removed deprecated /organize endpoint"
      ]
    }
  ]
}
```

## User Experience Flow

### Scenario 1: User Visits `/changelog`
```
1. Browser: GET /changelog
2. Server: Check setup status
3. Server: Load ~/.mindos/change-log.json
4. Client: Render ChangelogClient component
5. Client: Display changelog with search/filter
6. User: Search for "Save Session" feature
7. Client: Filter & highlight matching entry
8. User: Copy entry or share link
```

### Scenario 2: Legacy Bookmark `/changes`
```
1. Browser: GET /changes (bookmarked)
2. Server: Call redirect('/changelog')
3. Browser: GET /changelog (automatic)
4. ... (same as Scenario 1)
```

### Scenario 3: API Integration
```
1. Dashboard: GET /api/changes?op=summary
2. API: Return change statistics
3. Dashboard: Show "5 new changes" badge
4. User: Click badge → navigates to /changelog
```

## Technical Notes

### Architecture Decisions
- **Server Component for Page**: Setup check happens server-side (security)
- **Client Component for Rendering**: Interactivity (search, filter) on client
- **Separate API Endpoint**: Allows programmatic access (dashboards, notifications)
- **Redirect Strategy**: Simple, cacheable, SEO-friendly

### Performance
- Changelog file cached (loaded once at server startup)
- API filtering done server-side (reduced bandwidth)
- Client-side search uses `fuse.js` for instant feedback

### i18n Support
- Changelog entries are language-agnostic
- UI labels/buttons translated (EN/ZH)
- User's locale preference (from settings) controls display language

## Related Documentation

- **Changelog Format**: `wiki/90-changelog.md` (content standard)
- **Release Process**: `AGENTS.md` (发版说明)
- **Activity Tracking**: `wiki/refs/git-sync-workflow.md`

