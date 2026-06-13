'use client';

import dynamic from 'next/dynamic';

/**
 * Client-graph dynamic boundary for the zh locale initializer.
 *
 * The import() MUST live in a client module: client-side async edges produce
 * a real async chunk that stays out of the layout chunk group, so en requests
 * never get a <script> tag for messages-zh. (Referencing LocaleStoreInitZh
 * from the server graph — even via dynamic() — makes the flight-client-entry
 * plugin bundle it eagerly into the layout's client chunks for everyone.)
 *
 * With ssr:true and no `loading`, next/dynamic adds NO Suspense boundary, so
 * during hydration the lazy component suspends to the root: React keeps the
 * server-rendered zh HTML and defers hydrating the whole boundary until the
 * chunk arrives (preloaded via PreloadChunks on zh responses). The store is
 * therefore always initialized with zh before any sibling hydrates — no
 * en-text flash, no hydration mismatch.
 */
const LocaleStoreInitZh = dynamic(() => import('./LocaleStoreInitZh'));

export default function LocaleStoreInitZhLoader() {
  return <LocaleStoreInitZh />;
}
