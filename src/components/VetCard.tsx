import Link from "next/link";
import type { VetListing } from "@/data/types";
import { StarRating } from "@/components/StarRating";
import { careBadgeClass, telHref } from "@/lib/vets";

export function VetCard({
  vet,
  href,
}: {
  vet: VetListing;
  href: string;
}) {
  const showRating = vet.rating > 0 && vet.reviewCount > 0;

  return (
    <article className="vet-card">
      <div className="vet-card-top">
        <div className="vet-card-badges">
          <span className={`care-badge ${careBadgeClass(vet.careType)}`}>
            {vet.careType}
          </span>
          {vet.is24_7 ? <span className="open-badge">Open 24/7</span> : null}
        </div>
        {showRating ? (
          <div className="vet-card-rating">
            <StarRating rating={vet.rating} />
            <span className="rating-text">
              {vet.rating.toFixed(1)}
              <span className="rating-count">({vet.reviewCount})</span>
            </span>
          </div>
        ) : null}
      </div>

      <h3 className="vet-card-title">
        <Link href={href}>{vet.name}</Link>
      </h3>

      {vet.neighborhood ? (
        <p className="vet-card-hood">{vet.neighborhood}</p>
      ) : null}

      <ul className="vet-card-meta">
        <li>
          <span className="meta-label">Phone</span>
          <a href={telHref(vet.phone)}>{vet.phone}</a>
        </li>
        <li>
          <span className="meta-label">Hours</span>
          <span>{vet.hours}</span>
        </li>
        <li>
          <span className="meta-label">Address</span>
          <span>
            {vet.address}
            {vet.city ? `, ${vet.city}` : ""}
          </span>
        </li>
      </ul>

      <div className="vet-card-actions">
        {vet.phone && vet.phone !== "Call for number" ? (
          <a className="btn btn-primary" href={telHref(vet.phone)}>
            Call
          </a>
        ) : null}
        <Link className="btn btn-ghost" href={href}>
          Details
        </Link>
      </div>
    </article>
  );
}
