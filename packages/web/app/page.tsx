import { redirect } from 'next/navigation';
import { readSetupPending } from '@/lib/setup-state';
import { defaultEchoPath } from '@/lib/echo-segments';

// The setup gate reads ~/.mindos/config.json — evaluate it per request, never
// at build time, so finishing setup takes effect on the next visit.
export const dynamic = 'force-dynamic';

/**
 * `/` is a pure entry point: server-redirect to setup (when pending) or to the
 * default Echo page. Server redirects replace the old client-side
 * window.location.replace pattern, which shipped + hydrated a throwaway page
 * and then hard-reloaded, roughly doubling startup TTI.
 */
export default function HomePage() {
  if (readSetupPending()) redirect('/setup');
  redirect(defaultEchoPath());
}
