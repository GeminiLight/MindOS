import { listTrashAction } from '@/lib/actions';
import TrashPageClient from '@/components/TrashPageClient';

export default async function TrashPage() {
  // listTrashAction auto-purges expired items (>30 days) on each call
  const items = await listTrashAction();
  return <TrashPageClient initialItems={items} />;
}
