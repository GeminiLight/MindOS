# Search Improvements - Validation & Testing Guide

## Quick Validation Checklist

### ✅ Module Compilation
```bash
# Check TypeScript compilation
cd app
npm run build 2>&1 | grep -i error

# Or use dev server
npm run dev
# Should start without errors
```

### ✅ Unit Tests
```bash
# Run all tests
npm test

# Run specific test
npm test -- synonym-dict.test.ts
```

### ✅ Manual Testing

#### Test Case 1: Synonym Expansion (Quick Win #1)
```javascript
// In browser console or test:
import { expandQueryWithSynonyms } from 'app/lib/core/synonym-dict';

// Should expand to multiple synonyms
expandQueryWithSynonyms('架构');
// Expected: ['架构', '系统设计', '技术方案', 'architecture', 'design', ...]

// Should expand database terms
expandQueryWithSynonyms('数据库');
// Expected: ['数据库', 'database', 'db', 'storage']
```

#### Test Case 2: CJK Tokenization (Quick Win #2)
```javascript
// In test or console:
import { countTermOccurrences } from 'app/lib/core/search'; // Not exported, test indirectly

// Test via search results:
// Query: "机器学习"
// Should find: Documents with "机器学习", "机器", "学习"
// Should score correctly with word boundaries
```

#### Test Case 3: Unified CJK Fuzzy Search (Quick Win #3)
```javascript
// In browser UI:
// Open ⌘K search modal
// Try queries:
// 1. "架构" (exact) → should find results
// 2. "架构设" (typo) → should find "架构设计" documents
// 3. "database" (exact) → should find results
// 4. "databse" (typo) → should find "database" documents
// Result: Both CJK and English should find typos (previously only English did)
```

---

## Expected Search Improvements

### Scenario 1: Conceptual Query
```
Query: "架构"
Before: Only finds documents containing literal "架构"
After: Finds all of:
  - "架构"
  - "系统设计"
  - "技术方案"
  - "architecture"
  - "design"
  - "system design"
Impact: +300-500% recall on architecture-related queries
```

### Scenario 2: CJK with Typo
```
Query: "机器学习" with typo → "机器学"
Before: No results (exact-match mode)
After: Finds "机器学习" documents (fuzzy match)
Impact: Better UX, recovers from CJK input errors
```

### Scenario 3: Multi-term Query
```
Query: "database schema design"
Before: BM25 scoring with possible tokenization mismatches
After: Correct term frequencies for accurate ranking
Impact: Better result ranking due to consistent tokenization
```

---

## Performance Testing

### Startup Time
```bash
# Measure app startup
time npm run dev
# Expected: No noticeable increase (synonym dict is pre-computed)
```

### Search Response Time
```javascript
// In console:
console.time('search');
searchFiles('架构设计');
console.timeEnd('search');
// Expected: <50ms (synonym expansion adds <1ms)
```

### Memory Usage
```javascript
// In console:
import { expandQueryWithSynonyms } from 'app/lib/core/synonym-dict';
// Synonym dict loaded in memory: ~5KB
// Per-query overhead: 0 (uses pre-built map)
```

---

## Regression Testing

### Ensure Backward Compatibility
1. **Existing queries should work identically**
   ```bash
   # Test a query that has no synonyms:
   Query: "React hooks"
   # Should return identical results before/after
   ```

2. **Search index not affected**
   ```bash
   # Index is built the same way (before synonyms are applied)
   # Verify: index rebuild time unchanged
   ```

3. **No breaking API changes**
   ```bash
   # All function signatures unchanged
   # searchFiles(query, opts) still works
   # MCP tools still work
   ```

---

## Files to Verify

- ✅ `app/lib/core/synonym-dict.ts` — Created, contains 20+ synonym groups
- ✅ `app/lib/core/__tests__/synonym-dict.test.ts` — Created, 6 test cases
- ✅ `app/lib/core/search.ts` — Modified, synonym expansion + countTermOccurrences()
- ✅ `app/lib/fs.ts` — Modified, removed CJK exact-match forcing

### Code Integrity Checks
```bash
# Verify imports are correct
grep -r "synonym-dict" app/lib/core/search.ts
# Should show: import { expandQueryWithSynonyms } from './synonym-dict';

# Verify CJK fix is in place
grep -n "countTermOccurrences" app/lib/core/search.ts
# Should show: function definition and two call sites

# Verify Fuse.js fix is in place
grep -A 2 "FIXED: Removed CJK" app/lib/fs.ts
# Should show: const searchQuery = query;
```

---

## Deployment Checklist

Before merging to main:
- [ ] All TypeScript compiles without errors
- [ ] All tests pass (`npm test`)
- [ ] Dev server starts (`npm run dev`)
- [ ] Manual smoke tests passed (scenarios above)
- [ ] Code review completed
- [ ] Commit message is comprehensive

Before deploying to production:
- [ ] Run full test suite in CI
- [ ] Performance benchmarks acceptable
- [ ] No regressions in search results
- [ ] Synonym dictionary is complete

---

## Rollback Plan

If issues arise:

```bash
# Quick rollback (undoes all three improvements)
git revert <commit-sha>

# Or selective rollback:
git checkout HEAD~1 -- app/lib/core/synonym-dict.ts
git checkout HEAD~1 -- app/lib/core/__tests__/
git checkout HEAD~1 -- app/lib/core/search.ts
git checkout HEAD~1 -- app/lib/fs.ts
```

---

## Success Criteria

All improvements are successful when:

1. ✅ **Synonym expansion works**
   - `expandQueryWithSynonyms('架构')` returns 7+ terms
   - All synonym groups are bidirectional

2. ✅ **Tokenization is consistent**
   - BM25 scores are stable across queries
   - CJK word boundaries are respected

3. ✅ **Fuzzy search is unified**
   - CJK typos are found (fuzzy match)
   - English typos still work

4. ✅ **No performance regression**
   - Search latency unchanged or improved
   - Memory usage increase <1MB

5. ✅ **Full backward compatibility**
   - Existing queries work the same
   - No API changes
   - No breaking changes

---

## Support & Troubleshooting

### Issue: TypeScript compilation errors
```
Check: Is synonym-dict.ts in the right location?
Path should be: app/lib/core/synonym-dict.ts
```

### Issue: Synonym expansion not working
```
Check: Is expandQueryWithSynonyms imported correctly?
grep "import.*expandQueryWithSynonyms" app/lib/core/search.ts
```

### Issue: Search results changed
```
This is expected! Results should improve:
- More recall (find related concepts)
- Better ranking (consistent tokenization)
- Better UX (fuzzy match for typos)

If worse: Check if synonym groups are too broad
```

---

For detailed implementation info, see: MINDOS_SEARCH_IMPROVEMENTS_IMPLEMENTATION.md
