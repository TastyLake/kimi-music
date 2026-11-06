import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Кими — Милый музыкальный плеер',
  description: 'Кими — твой персональный облачный плеер',
  icons: {
    icon: '/icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f050b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen bg-[#0f050b] text-[#fce7f3] antialiased selection:bg-pink-500/30 selection:text-pink-200">
        {/* Фоновые неоновые вспышки */}
        <div className="kimi-bg" aria-hidden="true">
          <div className="kimi-spot-1" />
          <div className="kimi-spot-2" />
        </div>
        
        {children}
      </body>
    </html>
  );
}