import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { getCities } from "@/lib/directory";
import { cityPath } from "@/lib/paths";

const featuredSlugs = [
  "los-angeles",
  "san-diego",
  "san-francisco",
  "san-jose",
  "sacramento",
  "oakland",
  "fresno",
  "santa-barbara",
];

export default function HomePage() {
  const cities = getCities("ca");
  const featured = featuredSlugs
    .map((slug) => cities.find((c) => c.slug === slug))
    .filter(Boolean);

  return (
    <>
      <section className="home-hero">
        <div className="home-hero-media" aria-hidden />
        <div className="site-wrap home-hero-inner">
          <div className="brand-lockup">
            <BrandMark />
            <span className="brand-text">Dog Vet Near You</span>
          </div>
          <h1>Dog vets, by city. Emergency first.</h1>
          <p className="lede">
            Making it easier to find vets near you — all in one place.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/ca">
              Browse all cities
            </Link>
          </div>
        </div>
      </section>

      <section className="section site-wrap">
        <div className="section-head">
          <h2>Popular cities</h2>
          <p>Jump straight into a directory.</p>
        </div>
        <div className="popular-cities">
          {featured.map((city) =>
            city ? (
              <Link key={city.slug} href={cityPath("ca", city.slug)}>
                {city.name}
              </Link>
            ) : null,
          )}
          <Link href="/ca">All California →</Link>
        </div>
      </section>

      <section className="section site-wrap" style={{ paddingBottom: "3rem" }}>
        <div className="section-head">
          <h2>How to use it</h2>
          <p>Built for the moment you need a vet — not a brochure.</p>
        </div>
        <div className="how-it-works">
          <article className="how-step">
            <strong>1. Find your city</strong>
            <p>
              Search from the nav or browse California. Every city has a page.
            </p>
          </article>
          <article className="how-step">
            <strong>2. Check emergency first</strong>
            <p>
              24/7 and urgent clinics rise to the top so you don’t dig past
              what matters.
            </p>
          </article>
          <article className="how-step">
            <strong>3. Call with confidence</strong>
            <p>
              Phone, address, hours, and reviews sit on every clinic — ready
              when you are.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
