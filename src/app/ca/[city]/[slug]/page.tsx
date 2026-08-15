import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewList } from "@/components/ReviewList";
import { StarRating } from "@/components/StarRating";
import {
  cityPath,
  getCities,
  getCity,
  getVet,
  getVetsForCity,
} from "@/lib/directory";
import { careBadgeClass, fullAddress, mapsHref, telHref, websiteHref } from "@/lib/vets";

type Props = {
  params: Promise<{ city: string; slug: string }>;
};

export async function generateStaticParams() {
  return getCities("ca").flatMap((city) =>
    getVetsForCity("ca", city.slug).map((vet) => ({
      city: city.slug,
      slug: vet.slug,
    })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug, slug } = await params;
  const city = getCity("ca", citySlug);
  const vet = getVet("ca", citySlug, slug);
  if (!city || !vet) return { title: "Clinic not found" };
  return {
    title: `${vet.name} · ${city.name}`,
    description: vet.description,
  };
}

export default async function VetDetailPage({ params }: Props) {
  const { city: citySlug, slug } = await params;
  const city = getCity("ca", citySlug);
  const vet = getVet("ca", citySlug, slug);
  if (!city || !vet) notFound();

  return (
    <div className="site-wrap">
      <section className="detail-hero">
        <Link className="back-link" href={cityPath("ca", citySlug)}>
          ← All {city.name} vets
        </Link>
        <div className="vet-card-badges">
          <span className={`care-badge ${careBadgeClass(vet.careType)}`}>
            {vet.careType}
          </span>
          {vet.is24_7 ? <span className="open-badge">Open 24/7</span> : null}
        </div>
        <h1 className="detail-title">{vet.name}</h1>
        {vet.rating > 0 && vet.reviewCount > 0 ? (
          <div className="vet-card-rating" style={{ marginTop: "0.85rem" }}>
            <StarRating rating={vet.rating} size="lg" />
            <span className="rating-text">
              {vet.rating.toFixed(1)}
              <span className="rating-count">
                ({vet.reviewCount} public reviews)
              </span>
            </span>
          </div>
        ) : null}
        <p className="detail-lede">{vet.description}</p>
        <div className="detail-actions">
          {vet.phone && vet.phone !== "Call for number" ? (
            <a className="btn btn-primary" href={telHref(vet.phone)}>
              Call {vet.phone}
            </a>
          ) : null}
          {vet.phoneSecondary ? (
            <a className="btn btn-ghost" href={telHref(vet.phoneSecondary)}>
              Alt {vet.phoneSecondary}
            </a>
          ) : null}
          <a
            className="btn btn-ghost"
            href={mapsHref(vet)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get directions
          </a>
          {vet.website ? (
            <a
              className="btn btn-ghost"
              href={websiteHref(vet.website)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit website
            </a>
          ) : null}
        </div>
      </section>

      <div className="detail-grid">
        <div className="panel">
          <h2>Contact & location</h2>
          <ul className="contact-list">
            <li>
              <span className="label">Phone</span>
              <a href={telHref(vet.phone)}>{vet.phone}</a>
            </li>
            {vet.phoneSecondary ? (
              <li>
                <span className="label">Text / alt</span>
                <a href={telHref(vet.phoneSecondary)}>{vet.phoneSecondary}</a>
              </li>
            ) : null}
            {vet.email ? (
              <li>
                <span className="label">Email</span>
                <a href={`mailto:${vet.email}`}>{vet.email}</a>
              </li>
            ) : null}
            <li>
              <span className="label">Address</span>
              <a href={mapsHref(vet)} target="_blank" rel="noopener noreferrer">
                {fullAddress(vet)}
              </a>
            </li>
            {vet.neighborhood ? (
              <li>
                <span className="label">Area</span>
                <span>{vet.neighborhood}</span>
              </li>
            ) : null}
            {vet.website ? (
              <li>
                <span className="label">Website</span>
                <a
                  href={websiteHref(vet.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {vet.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="panel">
          <h2>Hours</h2>
          <ul className="hours-list">
            {(vet.hoursDetail ?? [vet.hours]).map((line) => (
              <li key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Services for dogs</h2>
          <ul className="service-list">
            {vet.services.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Why pet parents choose them</h2>
          <ul className="highlight-list">
            {vet.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <ReviewList
        reviews={vet.reviews}
        clinicName={vet.name}
        website={vet.website}
      />
    </div>
  );
}
