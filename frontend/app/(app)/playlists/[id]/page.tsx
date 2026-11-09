import PlaylistClient from './PlaylistClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/playlists/${id}`, {
    cache: 'no-store'
  });
  
  const playlist = res.ok ? await res.json() : { id, title: 'Плейлист', tracks: [] };

  return <PlaylistClient playlist={playlist} />;
}
