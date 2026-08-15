import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmergencyContactStrip } from "@/components/EmergencyContactStrip";
import { VetDirectory } from "@/components/VetDirectory";
import {
  cityHasListings,
  defaultCityDescription,
  getCities,
  getCity,
  getVetsForCity,
  vetPath,
} from "@/lib/directory";

type Props = {
  params: Promise<{ city: string }>;
};

export async function generateStaticParams() {
  return getCities("ca").map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = getCity("ca", citySlug);
  if (!city) return { title: "City not found" };
  return {
    title: `${city.name} Dog Vets & 24/7 Emergency Care`,
    description: defaultCityDescription(city),
  };
}

export default async function CityPage({ params }: Props) {
  const { city: citySlug } = await params;
  const city = getCity("ca", citySlug);
  if (!city) notFound();

  const vets = getVetsForCity("ca", citySlug);
  const emergency = vets.filter(
    (v) => v.is24_7 || v.careType === "24/7 Emergency",
  );
  const urgent = vets.filter((v) => v.careType === "Urgent Care");
  const isLive = cityHasListings("ca", citySlug);

  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="page-kicker">
          <Link href="/ca">California</Link>
          {" / "}
          {city.county} County
        </p>
        <h1>{city.name}</h1>
        <p className="lede">
          Dog veterinarians near you
          {isLive
            ? ` — ${vets.length} clinic${vets.length === 1 ? "" : "s"}.`
            : "."}{" "}
          Emergency and urgent care appear first.
        </p>
        <div className="meta-row">
          {isLive ? (
            <>
              <span>{vets.length} clinics</span>
              {emergency.length ? (
                <span>{emergency.length} emergency / 24/7</span>
              ) : null}
              {urgent.length ? <span>{urgent.length} urgent care</span> : null}
            </>
          ) : (
            <span>Clinics coming soon</span>
          )}
        </div>
      </section>

      {isLive ? (
        <>
          <EmergencyContactStrip
            vets={vets}
            cityName={city.name}
            emergencyProfileHref={
              emergency[0]
                ? vetPath("ca", citySlug, emergency[0].slug)
                : undefined
            }
          />
          <VetDirectory vets={vets} stateSlug="ca" citySlug={citySlug} />
        </>
      ) : (
        <section className="panel pending-panel">
          <h2>Clinics not online yet</h2>
          <p>
            {city.name} is in the directory, but clinic data hasn’t been loaded
            yet. Try another California city from the list.
          </p>
          <div className="detail-actions">
            <Link className="btn btn-primary" href="/ca">
              Browse California cities
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
