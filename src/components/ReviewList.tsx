import type { Review } from "@/data/types";
import { StarRating } from "@/components/StarRating";

export function ReviewList({
  reviews,
  clinicName,
}: {
  reviews: Review[];
  clinicName: string;
}) {
  if (!reviews.length) return null;

  return (
    <section className="reviews-section" aria-labelledby="reviews-heading">
      <div className="section-head">
        <h2 id="reviews-heading">Reviews</h2>
        <p>What pet parents have shared about {clinicName}.</p>
      </div>
      <div className="reviews-grid">
        {reviews.map((review) => (
          <figure key={`${review.author}-${review.text.slice(0, 24)}`} className="review-card">
            <div className="review-card-top">
              <StarRating rating={review.rating} size="sm" />
              <span className="review-source">{review.source}</span>
            </div>
            <blockquote>
              <p>“{review.text}”</p>
            </blockquote>
            <figcaption>
              <span className="review-author">{review.author}</span>
              {review.date ? (
                <span className="review-date">{review.date}</span>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
