export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `brand-mark ${className}` : "brand-mark"}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <ellipse cx="6.2" cy="7.2" rx="2.35" ry="3" transform="rotate(-18 6.2 7.2)" />
      <ellipse cx="10.2" cy="4.6" rx="2.2" ry="2.85" />
      <ellipse cx="14.6" cy="4.6" rx="2.2" ry="2.85" />
      <ellipse cx="18.4" cy="7.2" rx="2.35" ry="3" transform="rotate(18 18.4 7.2)" />
      <path d="M12 10.4c-2.55 0-5.35 1.55-5.7 4.35-.25 2 1.1 3.55 2.85 4.45 1.15.6 2.2 1.15 2.85 1.15s1.7-.55 2.85-1.15c1.75-.9 3.1-2.45 2.85-4.45C17.35 11.95 14.55 10.4 12 10.4Z" />
    </svg>
  );
}
