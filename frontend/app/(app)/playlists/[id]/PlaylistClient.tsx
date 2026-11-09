'use client';

import React, { useState } from 'react';
import { Cover } from '@/components/Cover';
import { Track } from '@/lib/types'; // <-- Исправленный путь к типам

interface PlaylistClientProps {
  playlist: {
    id: string;
    title: string;
    description?: string;
    tracks: Track[];
  };
}

export default function PlaylistClient({ playlist }: PlaylistClientProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-6 items-start mb-8">
        <div className="w-48 h-48 rounded-lg overflow-hidden shadow-lg bg-gray-800 flex-shrink-0">
          <Cover 
            url={playlist.tracks[0]?.coverUrl} 
            title={playlist.title}
            className="w-full h-full object-cover" 
          />
        </div>
        <div className="flex flex-col justify-end">
          <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">Плейлист</span>
          <h1 className="text-4xl font-extrabold text-white mt-1 mb-2">{playlist.title}</h1>
          <p className="text-gray-300 max-w-xl">{playlist.description || "Описание плейлиста отсутствует."}</p>
          <div className="mt-4 flex items-center gap-4 text-sm text-gray-400">
            <span>{playlist.tracks.length} треков</span>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 pt-6">
        <h2 className="text-2xl font-bold text-white mb-4">Треки</h2>
        {playlist.tracks.length === 0 ? (
          <p className="text-gray-500">В этом плейлисте пока нет треков.</p>
        ) : (
          <div className="space-y-2">
            {playlist.tracks.map((track, index) => (
              <div 
                key={track.id || index}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <span className="text-gray-500 w-6 text-center">{index + 1}</span>
                  <div className="w-12 h-12 rounded overflow-hidden bg-gray-700 flex-shrink-0">
                    <Cover 
                      url={track.coverUrl} 
                      title={track.title} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  <div>
                    <h4 className="text-white font-medium group-hover:text-primary transition-colors">{track.title}</h4>
                    <p className="text-sm text-gray-400">{track.artist || 'Неизвестный исполнитель'}</p>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {track.duration || '0:00'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
