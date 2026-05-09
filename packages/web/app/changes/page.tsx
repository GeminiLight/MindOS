import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default function ChangesPage() {
  return <ClientRedirect href="/changelog" label="Redirecting to changelog..." />;
}
