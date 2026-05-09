import ClientRedirect from '@/components/ClientRedirect';
import { defaultEchoSegment } from '@/lib/echo-segments';

export default function EchoIndexPage() {
  return <ClientRedirect href={`/echo/${defaultEchoSegment()}`} label="Redirecting to Echo..." />;
}
