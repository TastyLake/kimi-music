'use client';

import { Pause, Play } from 'lucide-react';
import { resolveExternalSrc } from '@/lib/api';
import { usePlayer } from '@/store/player';

interface Props {
  artist: string;
  title: string;
  album?: string | null;
  coverUrl?: string | null;
  duration?: number;
}

export function ExternalPlayButton({ artist, title, album, coverUrl, duration }: Props) {
  const current = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const active = current?.kind === 'preview' && current.artist === artist && current.title === title;

  const play = async () => {
    const player = usePlayer.getState();
    if (active) {
      player.toggle();
      return;
    }
    const src = await resolveExternalSrc(artist, title);
    player.playQueue([{ kind: 'preview', title, artist, album, coverUrl, duration, src }]);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        play();
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-pink-400/40 px-3 py-1.5 text-xs font-semibold text-pink-100 transition-colors hover:bg-pink-500/20"
    >
      {active && playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      Слушать
    </button>
  );
}
