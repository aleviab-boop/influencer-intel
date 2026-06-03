import { ShortlistView } from '@/components/shortlist-view';

export default async function ShortlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ShortlistView briefId={id} />;
}
