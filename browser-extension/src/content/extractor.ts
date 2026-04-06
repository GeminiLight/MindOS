/* ── Content Script — Extracts page content via Readability ── */
/* Injected on demand by popup via chrome.scripting.executeScript() */

import { Readability } from '@mozilla/readability';

/** Extract article content from the current page */
function extractPageContent() {
  // Clone document so Readability mutations don't affect the live page
  const docClone = document.cloneNode(true) as Document;

  const reader = new Readability(docClone, {
    charThreshold: 100,
  });

  const article = reader.parse();

  const title = article?.title || document.title || 'Untitled';
  const content = article?.content || document.body.innerHTML;
  const textContent = article?.textContent || document.body.textContent || '';
  const wordCount = textContent.split(/\s+/).filter(Boolean).length;

  return {
    title,
    byline: article?.byline || null,
    excerpt: article?.excerpt || null,
    content,
    textContent,
    siteName: article?.siteName || null,
    url: window.location.href,
    savedAt: new Date().toISOString(),
    wordCount,
  };
}

// Return result to executeScript caller
extractPageContent();
