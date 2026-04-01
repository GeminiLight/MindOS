import { listTrashAction } from '@/lib/actions';
import TrashPageClient from '@/components/TrashPageClient';

export default async function TrashPage() {
  const items = await listTrashAction();
  return <TrashPageClient initialItems={items} />;
}
