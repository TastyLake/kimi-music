export function LoralLogo({
  size = 28,
  withWordmark = true,
  className = '',
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id="loral-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5c518" />
            <stop offset="100%" stopColor="#b8860b" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="#111108" stroke="url(#loral-g)" strokeWidth="1.5" />
        <path d="M9 7.5h3.2v13.2H22V24H9V7.5Z" fill="url(#loral-g)" />
        <rect x="23.2" y="14.2" width="1.5" height="5.2" rx="0.6" fill="#f5c518" opacity="0.9" />
        <rect x="26" y="12.4" width="1.5" height="7" rx="0.6" fill="#f5c518" opacity="0.55" />
      </svg>
      {withWordmark && (
        <span className="text-lg font-bold tracking-tight text-white">
          Lor<span className="text-accent">al</span>
        </span>
      )}
    </div>
  );
}
