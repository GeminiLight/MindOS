import { redirect } from 'next/navigation';
import { defaultEchoPath } from '@/lib/echo-segments';

/** `/echo` server-redirects to the default segment (no client hard-reload). */
export default function EchoIndexPage() {
  redirect(defaultEchoPath());
}
