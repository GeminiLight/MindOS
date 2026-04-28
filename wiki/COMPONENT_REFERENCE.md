# Component Reference

Quick reference for 150+ MindOS components. For full implementation details, see individual component files.

## UI Primitives

### Buttons & Interactions
- **Button** — `<button>` wrapper with variants (primary/secondary/destructive)
- **ConfirmDialog** — Modal confirmation with Esc/Click-outside-close
- **ContextMenuShell** — Right-click context menu with keyboard navigation
- **Toaster** — Global toast notification container (role="status")

### Modals & Overlays
- **CreateSpaceModal** — Create new space/workspace dialog
- **ExportModal** — File/space export options with format selector
- **SearchModal** — Global search modal with Cmd+K shortcut
- **SettingsModal** — Settings panel (fullscreen)
- **ImportModal** — File/directory import dialog
- **KeyboardShortcuts** — Help modal listing all keyboard shortcuts

### Navigation & Layout
- **ActivityBar** — Left sidebar icon rail (collapsible)
- **Panel** — Resizable left panel for file/search/agents/echo
- **RightAskPanel** — Right-side ask/chat panel (resizable)
- **RightAgentDetailPanel** — Right-side agent details panel
- **SidebarLayout** — Main app shell (Activity + Panel + Content + Right panels)
- **Sidebar** — File tree container

### Forms & Inputs
- **Input** (native HTML with focus ring styling)
- **Textarea** (native HTML with focus ring styling)
- **Select** (native HTML or custom dropdown)
- **Checkbox/Radio** (native HTML)
- **ColorPicker** (for theme/status colors)

### Content Display
- **Table** — Files list, search results, data tables
- **Card** — Generic card container
- **Badge** — Status/tag display
- **Empty State** — Placeholder when no data (icon + text + CTA)
- **Skeleton Screen** — Loading placeholder (animate-pulse)

---

## Feature Components

### File Management
- **FileTree** — Recursive directory/file tree (resizable, draggable, editable)
- **FileNode** — Individual file item (inline rename via double-click)
- **DirectoryNode** — Folder item (collapsible, contextual menu)
- **PinnedFilesSection** — Favorite files shortcut list
- **TrashPageClient** — Recycle bin with restore/delete options

### Search
- **SearchPanel** — Full-text search interface
- **SearchModal** — Quick search modal (Cmd+K)
- **SearchResults** — Paginated results display

### AI/Agents
- **AgentsPanel** — List of connected AI agents
- **AgentPickerPopover** — Agent selection dropdown
- **AgentsPanelAgentDetail** — Agent configuration view
- **DiscoverAgentModal** — Browse & install new agents
- **SkillDetailPopover** — Skill settings overlay
- **AgentsMcpSection** — MCP server status

### Content & Echo
- **EchoPanel** — Personal daily insights (about-you, continued, growth)
- **EchoSpotlight** — Weekly highlight card
- **EchoSidebar** — Echo section navigation

### Chat/Ask
- **AskFab** — Floating action button (Cmd+Shift+K)
- **AskModal** — Quick ask modal
- **AskContent** — Chat message display + input
- **RightAskPanel** — Chat history sidebar
- **ToolCallBlock** — LLM tool invocation display
- **SessionHistory** — Chat session list (inline rename)

### Settings & Config
- **SettingsModal** — Settings pages (Sync, About, Knowledge, Agents, etc.)
- **KnowledgeTab** — File location & MIND_ROOT config
- **SyncTab** — Git sync settings
- **ThemeSelector** — Light/dark/auto mode picker
- **KeyboardShortcuts** — Help overlay

### Workflows
- **WorkflowsPanel** — User-defined automation panel
- **WorkflowCard** — Workflow item (edit/delete options)

### UI Patterns
- **SectionTitle** — Section heading with icon & count
- **PanelHeader** — Panel top bar (title, controls)
- **StatusBar** — Sync/connection status indicator
- **Tooltip** — Hover hint (title attribute or Popover)
- **Breadcrumb** — Navigation path (for nested views)
- **TabsPanel** — Tab navigation (segments)

---

## Design System

### Config Files
- **`lib/config/panel-sizes.ts`** — Panel width constants (centralized)
- **`lib/config/icon-scale.ts`** — Icon size scale (xs/sm/md/lg/xl)
- **`app/globals.css`** — CSS variables (--amber, --success, --error, etc.)

### Styling
- **Tailwind CSS** — Utility-first styling
- **CSS Variables** — Theme colors, semantic tokens
- **Focus Ring** — `focus-visible:ring-2 focus-visible:ring-ring`
- **Animations** — 150-300ms transitions, `prefers-reduced-motion` respected

### Accessibility
- **ARIA** — `role`, `aria-label`, `aria-expanded`, `aria-live`
- **Keyboard** — Tab navigation, Esc to close, Enter to confirm
- **Focus Management** — Focus trap in modals, return focus on close
- **Touch Targets** — All interactive elements ≥40px
- **Contrast** — WCAG AA compliant text colors

---

## Usage Examples

### Creating a New Component

```tsx
import { useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { ICON_SIZES } from '@/lib/config/icon-scale';
import { useLocale } from '@/lib/stores/locale-store';

export function MyComponent({ title, isLoading }: {
  title: string;
  isLoading?: boolean;
}) {
  const { t } = useLocale();

  const handleClick = useCallback(() => {
    // Action
  }, []);

  return (
    <div className="p-4 rounded-lg border border-border">
      <div className="flex items-center gap-2">
        <AlertCircle size={ICON_SIZES.md} className="text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <button
        onClick={handleClick}
        disabled={isLoading}
        className="mt-3 px-3 py-1 rounded bg-[var(--amber)] text-background disabled:opacity-50"
      >
        {isLoading ? t.common?.loading : t.common?.action}
      </button>
    </div>
  );
}
```

### Responsive & Mobile

- Use CSS Grid with `@container` for responsive layouts
- Mobile breakpoint: 375px → stack panels vertically
- Tablet: 768px → side-by-side panels
- Desktop: 1024px+ → full 3-column layout

---

## Common Patterns

### State Management
- **Zustand stores** — Global state (settings, locale, mcp-server, etc.)
- **useState** — Local component state
- **useCallback** — Memoized callbacks (dependency arrays)
- **useSyncExternalStore** — Subscribe to external sources (localStorage)

### Data Fetching
- **Server actions** — `'use server'` for mutations
- **API routes** — `/api/*` endpoints for read-heavy queries
- **Optimistic updates** — UI updates before server response
- **Error boundaries** — Graceful error handling

### Forms
- **Validation onBlur** — Schema validation when user leaves field
- **Submission validation** — Full validation before API call
- **Error messages** — Clear, actionable guidance (not just "Invalid")
- **Loading states** — Spinner or disabled button during submission

---

## Testing Checklist

- [ ] Component renders without errors
- [ ] All props work as expected
- [ ] Keyboard navigation (Tab, Enter, Esc)
- [ ] Mobile responsive (375px, 768px, 1440px)
- [ ] Accessibility (WCAG AA): contrast, ARIA, focus ring
- [ ] Error state (loading, error, empty)
- [ ] Dark mode (light/dark CSS variables)

---

## Architecture Notes

- **No Storybook** — Lightweight design system via config + examples
- **Client-side first** — Server rendering used selectively for SEO/performance
- **Progressive enhancement** — Works without JS (forms, links)
- **Design tokens** — All magic numbers in `lib/config/*.ts`
- **Consistent naming** — Components exported at `app/components/`

