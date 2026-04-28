import { redirect } from 'next/navigation';
import { defaultEchoSegment } from '@/lib/echo-segments';

export default function EchoIndexPage() {
  redirect(`/echo/${defaultEchoSegment()}`);
}
