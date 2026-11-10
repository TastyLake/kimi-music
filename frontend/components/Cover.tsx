import { assetUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Cover({
  url,
  title,
  size = 40,
  className,
}: {
  url?: string | null;
  title: string;
  size?: number;
  className?: string;
}) {
  const src = assetUrl(url);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={cn('shrink-0 rounded bg-zinc-800 object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const hue = 28 + ([...title].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 28); // янтарная гамма
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded font-semibold text-white/70', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(size * 0.4, 10),
        background: `linear-gradient(135deg, hsl(${hue} 70% 38%), hsl(${hue - 10} 60% 14%))`,
      }}
    >
      {title.trim()[0]?.toUpperCase() ?? '♪'}
    </div>
  );
}
