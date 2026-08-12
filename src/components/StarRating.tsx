export function StarRating({
  rating,
  size = "md",
}: {
  rating: number;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";

  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${rating.toFixed(1)} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.min(1, Math.max(0, rating - i));
        return (
          <span key={i} className={`relative inline-block ${dim}`}>
            <svg
              viewBox="0 0 20 20"
              className={`${dim} text-[var(--star-empty)]`}
              aria-hidden
            >
              <path
                fill="currentColor"
                d="M10 1.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 13.8l-4.8 2.6.9-5.4L2.2 7.2l5.4-.8L10 1.5z"
              />
            </svg>
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <svg
                viewBox="0 0 20 20"
                className={`${dim} text-[var(--star)]`}
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M10 1.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 13.8l-4.8 2.6.9-5.4L2.2 7.2l5.4-.8L10 1.5z"
                />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}
