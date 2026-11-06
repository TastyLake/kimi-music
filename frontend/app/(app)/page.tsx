'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function AppPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/library');
  }, [router]);

  return (
    <div className="flex h-[80vh] w-full flex-col items-center justify-center gap-3">
      <Loader2 size={36} className="animate-spin text-pink-400" />
      <p className="text-sm font-medium text-pink-200/70">Загрузка Кими…</p>
    </div>
  );
}