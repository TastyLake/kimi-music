import PlaylistClient from './PlaylistClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <PlaylistClient id={id} />;
}
