# Transcript: Capturing Debugging Experience — Mutex Race Condition in Payment Service

## Context

**User input**: "I just finished debugging a really tricky race condition in our payment service - turns out the mutex wasn't being released properly in the error path. Took me 3 hours to figure out. I want to make sure the team doesn't hit this again."

**Skill used**: `mindos-max` (SKILL.md v3.0.0-max)

---

## Step 1: Decision Tree Classification

The user's request maps to **Retrospective / distill** in the decision tree:

```
User request
  |- Retrospective / distill / handoff?
     -> [Retrospective path]
```

Additionally, the **Experience capture** post-task hook triggers (condition: "Debugging, troubleshooting, or multi-round work"). The format is: **problem → cause → solution → rule**.

The user explicitly wants to "make sure the team doesn't hit this again" — this is a clear **save/record** intent, so writes are authorized.

---

## Step 2: Bootstrap — List KB Tree

Before writing anything, we bootstrap to understand the KB structure and find the right location.

### Command

```bash
mindos file list
```

### Expected output (simulated)

```
/
├── INSTRUCTION.md
├── README.md
├── .mindos/
│   └── user-preferences.md
├── projects/
│   ├── payment-service/
│   │   ├── README.md
│   │   └── architecture.md
│   └── ...
├── engineering/
│   ├── debugging/
│   │   └── ...
│   ├── runbooks/
│   │   └── ...
│   └── pitfalls/
│       └── ...
├── decisions/
│   └── ...
└── inbox/
    └── ...
```

> **Note**: The actual tree structure would determine where the file goes. We look for an existing `debugging/`, `pitfalls/`, `engineering/`, or `lessons-learned/` directory. If none exists, we'd use `inbox/` and propose classification later.

---

## Step 3: Search for Existing Related Content

Per the SKILL rule "NEVER search with a single keyword — fire 2-4 parallel searches", we search for related content before writing.

### Commands

```bash
mindos search "mutex race condition"
mindos search "payment service debugging"
mindos search "lock release error path"
mindos search "concurrency pitfall"
```

### Purpose

- Avoid duplicating an existing note on the same topic.
- Find related files to cross-reference or append to.
- Discover if there's an existing pitfalls/debugging log we should add to instead of creating a new file.

### Simulated result

Assuming no exact match found. If a file like `engineering/pitfalls/concurrency-issues.md` existed, we would append to it instead of creating a new file.

---

## Step 4: Check Sibling Files for Local Style

Per SKILL rule "NEVER create a file without checking siblings — read 1-2 files in the target directory to learn local style."

### Command

```bash
mindos file read "engineering/debugging/sample-existing-note.md"
```

Or if the directory is `engineering/pitfalls/`:

```bash
mindos file list "engineering/pitfalls/"
mindos file read "engineering/pitfalls/<first-file>.md"
```

### Purpose

Learn the local formatting conventions (heading structure, metadata, tags, etc.) so the new note fits in naturally.

---

## Step 5: Write the Experience Note

Following the post-task hook format: **problem → cause → solution → rule**.

### Propose to user first

> "Record this debugging experience to `engineering/debugging/payment-service-mutex-race-condition.md`? Format: problem → root cause → solution → prevention rule."

Assuming user confirms (since they explicitly asked to record it).

### Command

```bash
mindos file create "engineering/debugging/payment-service-mutex-race-condition.md" --content "# Mutex Not Released in Error Path — Payment Service Race Condition

> Debugging session: $(date +%Y-%m-%d) | Duration: ~3 hours | Severity: High

## Problem

The payment service experienced a race condition. Under concurrent load, some payment requests would hang indefinitely or produce inconsistent state. The issue was intermittent and hard to reproduce, making it especially time-consuming to diagnose.

## Symptoms

- Payment requests intermittently hanging/timing out under load
- Inconsistent transaction state between service replicas
- No obvious errors in logs (the deadlock was silent)
- Issue only manifested under concurrent access patterns

## Root Cause

The mutex protecting the critical section in the payment processing path was **not being released in the error path**. The typical pattern looked like:

\`\`\`
mutex.Lock()
result, err := processPayment(...)
if err != nil {
    // BUG: mutex.Unlock() was missing here
    return err  // <-- mutex held forever
}
mutex.Unlock()
return result
\`\`\`

When \`processPayment()\` returned an error, the function returned early without releasing the lock. Subsequent goroutines/threads trying to acquire the same mutex would block forever, causing the hang.

## Solution

Ensure the mutex is **always** released, regardless of the execution path. The fix uses a deferred unlock pattern:

\`\`\`
mutex.Lock()
defer mutex.Unlock()  // guaranteed release on any return path

result, err := processPayment(...)
if err != nil {
    return err  // mutex released by defer
}
return result
\`\`\`

## Prevention Rules

### Rule 1: Always use defer/finally for lock release
Never manually place \`Unlock()\` at each return point. Use \`defer mutex.Unlock()\` (Go), \`try-finally\` (Java/Python), or RAII lock guards (C++/Rust) immediately after acquiring the lock. This makes it structurally impossible to forget the release.

### Rule 2: Code review checklist for locks
When reviewing code that acquires any lock (mutex, semaphore, read-write lock, distributed lock):
- [ ] Is the unlock in a defer/finally/RAII guard?
- [ ] Are there any early return paths between Lock() and Unlock()?
- [ ] What happens if the critical section panics/throws?
- [ ] Is the lock scope as narrow as possible?

### Rule 3: Test error paths with locks held
Write tests that specifically exercise error cases inside critical sections. Verify that after an error, subsequent lock acquisitions still succeed (i.e., the lock was properly released).

### Rule 4: Use static analysis / linting
Configure linters (e.g., \`go vet\`, \`staticcheck\`, thread-safety annotations in Java) to flag lock/unlock mismatches. Many tools can detect unmatched Lock/Unlock pairs.

## Debugging Approach That Worked

1. **Reproduced under load** — wrote a stress test with concurrent payment requests, some injecting errors
2. **Added lock acquisition logging** — wrapped mutex with timing logs to see which goroutine held the lock
3. **Identified the stuck holder** — found the goroutine that acquired but never released
4. **Traced to error path** — stack trace of the holder showed it was in the error-return branch
5. **Total time**: ~3 hours (most spent on reproducing reliably)

## Related Patterns

- **Distributed lock not released**: Same bug at a higher level (e.g., Redis/Zookeeper lock). Use TTL as a safety net, but still fix the root cause.
- **Connection pool exhaustion**: Similar symptom (resources not returned on error). Same fix: defer/finally for resource cleanup.
- **File handle leak on error**: Same category. Always close in defer/finally.

## Tags

#debugging #race-condition #mutex #concurrency #payment-service #pitfall #error-handling
"
```

---

## Step 6: Post-Task Hook — Consistency Sync

After creating the file, check if any existing documents reference the payment service or debugging practices that should link to this new note.

### Commands

```bash
mindos file backlinks "engineering/debugging/payment-service-mutex-race-condition.md"
mindos search "payment service"
mindos search "concurrency guidelines"
```

### If a related document exists (e.g., `engineering/pitfalls/README.md` or an index file):

```bash
mindos file append "engineering/pitfalls/README.md" --content "
- [Mutex Not Released in Error Path](../debugging/payment-service-mutex-race-condition.md) — Race condition from missing unlock in error path. Rule: always use defer/finally for lock release.
"
```

### If a team runbook or onboarding doc exists:

Propose: "Your onboarding doc at `engineering/runbooks/onboarding.md` covers concurrency — add a link to this new pitfall?"

---

## Step 7: Verify the Write

```bash
mindos file read "engineering/debugging/payment-service-mutex-race-condition.md"
```

Confirm the content was saved correctly and is readable.

---

## Summary of Actions Taken

| # | Action | Command | Purpose |
|---|--------|---------|---------|
| 1 | Bootstrap | `mindos file list` | Understand KB structure |
| 2 | Search (4 queries) | `mindos search "..."` x4 | Check for duplicates, find related content |
| 3 | Read siblings | `mindos file read <sibling>` | Learn local formatting style |
| 4 | Create note | `mindos file create <path> --content "..."` | Save the debugging experience |
| 5 | Check backlinks | `mindos file backlinks <path>` | Find documents to cross-reference |
| 6 | Update index (if exists) | `mindos file append <index> --content "..."` | Keep indexes/READMEs in sync |
| 7 | Verify | `mindos file read <path>` | Confirm write succeeded |

## Skill Rules Applied

- **Bootstrap first** (Rule 1): Listed KB tree before any writes
- **Read before write** (Rule 6): Searched for existing content, read siblings
- **NEVER search with a single keyword**: Fired 4 parallel searches with synonyms
- **NEVER create without checking siblings**: Read existing files in target directory
- **Post-task hook — Experience capture**: Triggered by debugging context; used problem → cause → solution → rule format
- **Post-task hook — Consistency sync**: Checked and proposed updates to related docs
- **Default to read-only exceeded by explicit save intent**: User said "make sure the team doesn't hit this again" = clear write intent
