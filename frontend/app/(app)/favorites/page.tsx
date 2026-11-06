'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { TrackTable } from '@/components/TrackTable';
import { api } from '@/lib/api';
import type { Paged, Track } from '@/lib/types';
import { trackToItem, usePlayer } from '@/store/player';

export default function FavoritesPage() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Paged<Track>>('/favorites', { query: { limit: 200 } })
      .then((r) => setTracks(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Избранное</h1>
        <button
          className="btn btn-primary"
          disabled={!tracks?.length}
          onClick={() => tracks && usePlayer.getState().playQueue(tracks.map(trackToItem), 0)}
        >
          <Play size={16} fill="currentColor" /> Играть
        </button>
      </div>
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
      {tracks && (
        <TrackTable
          tracks={tracks}
          onPlay={(i) => usePlayer.getState().playQueue(tracks.map(trackToItem), i)}
          onDelete={(id) => setTracks((ts) => ts && ts.filter((t) => t.id !== id))}
          // Снятая звезда не удаляет строку сразу: можно передумать до обновления страницы
          emptyText="Пока пусто. Нажмите ♥ у трека, чтобы добавить его сюда."
        />
      )}
    </div>
  );
}
