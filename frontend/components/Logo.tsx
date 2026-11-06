'vener client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <Link href="/library" className={cn("flex items-center gap-3 group", className)}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 via-rose-400 to-purple-400 shadow-lg shadow-pink-500/30 text-pink-950 transition-transform group-hover:scale-105">
        <Sparkles size={22} className="animate-pulse" />
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-black tracking-wider bg-gradient-to-r from-pink-200 via-rose-200 to-purple-200 bg-clip-text text-transparent uppercase font-mono">
          Kimi
        </span>
        <span className="text-[10px] font-bold tracking-widest text-pink-400/60 uppercase -mt-1">
          Music Play
        </span>
      </div>
    </Link>
  );
}