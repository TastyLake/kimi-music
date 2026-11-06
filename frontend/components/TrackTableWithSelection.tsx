'use client';

import { useState } from 'react';
import { CheckSquare, Square, Trash2, Heart, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Track } from '@/lib/types';

interface Props {
  tracks: Track[];
  onDeleteSelected?: (ids: string[]) => void;
  onAddToPlaylistSelected?: (ids: string[]) => void;
  onFavoriteSelected?: (ids: string[]) => void;
  onPlayTrack?: (track: Track, index: number) => void;
}

export function TrackTableWithSelection({
  tracks,
  onDeleteSelected,
  onAddToPlaylistSelected,
  onFavoriteSelected,
  onPlayTrack,
}: Props) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectAll = () => {
    if (selectedIds.size === tracks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tracks.map((t) => t.id)));
    }
  };

  const toggleTrack = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="space-y-3">
      {/* Кнопка активации режима выбора */}
      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          onClick={() => {
            setSelectMode(!selectMode);
            setSelectedIds(new Set());
          }}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all border',
            selectMode
              ? 'bg-pink-500/25 border-pink-400/50 text-pink-100 shadow-sm'
              : 'bg-pink-950/40 border-pink-500/20 text-pink-300 hover:bg-pink-900/30',
          )}
        >
          <CheckSquare size={16} />
          {selectMode ? 'Выйти из режима выбора' : 'Выбрать несколько треков'}
        </button>

        {selectMode && (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 text-xs font-semibold text-pink-300 hover:text-pink-100 transition-colors"
          >
            {selectedIds.size === tracks.length ? <CheckSquare size={16} /> : <Square size={16} />}
            {selectedIds.size === tracks.length ? 'Снять выделение' : 'Выбрать все'}
          </button>
        )}
      </div>

      {/* Панель массовых действий */}
      {selectMode && selectedIds.size > 0 && (
        <div className="sticky top-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-pink-500/30 bg-pink-950/90 p-3.5 shadow-xl backdrop-blur-xl">
          <span className="text-xs font-bold text-pink-200 pl-2">
            Выбрано: {selectedIds.size}
          </span>
          <div className="flex items-center gap-2">
            {onFavoriteSelected && (
              <button
                type="button"
                onClick={() => onFavoriteSelected(Array.from(selectedIds))}
                className="flex items-center gap-1.5 rounded-xl bg-pink-900/50 border border-pink-500/30 px-3 py-1.5 text-xs font-semibold text-pink-200 hover:bg-pink-800/60"
              >
                <Heart size={14} className="text-pink-400" />
                В любимые
              </button>
            )}
            {onAddToPlaylistSelected && (
              <button
                type="button"
                onClick={() => onAddToPlaylistSelected(Array.from(selectedIds))}
                className="flex items-center gap-1.5 rounded-xl bg-pink-900/50 border border-pink-500/30 px-3 py-1.5 text-xs font-semibold text-pink-200 hover:bg-pink-800/60"
              >
                <PlusCircle size={14} />
                В плейлист
              </button>
            )}
            {onDeleteSelected && (
              <button
                type="button"
                onClick={() => onDeleteSelected(Array.from(selectedIds))}
                className="flex items-center gap-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
              >
                <Trash2 size={14} />
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}