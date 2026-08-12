import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CityDirectory } from "@/components/CityDirectory";
import { getCities, getClinicCount, getState } from "@/lib/directory";

export const metadata: Metadata = {
  title: "California Dog Vets by City",
  description:
    "Browse every California city for dog vets, 24/7 emergency hospitals, and urgent care.",
};

export default function CaliforniaHubPage() {
  const state = getState("ca");
  if (!state) notFound();
  const cities = getCities("ca");
  const clinicCount = getClinicCount("ca");

  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="page-kicker">United States</p>
        <h1>California</h1>
        <p className="lede">
          Choose a city to see local dog vets. Emergency and urgent care are
          ranked first on every directory.
        </p>
        <div className="meta-row">
          <span>{state.cityCount.toLocaleString("en-US")} cities</span>
          <span>{clinicCount.toLocaleString("en-US")} clinics</span>
        </div>
        <div className="detail-actions">
          <Link className="btn btn-primary" href="/ca/santa-barbara">
            Open Santa Barbara
          </Link>
          <a className="btn btn-ghost" href="#cities">
            Jump to list
          </a>
        </div>
      </section>

      <div id="cities">
        <CityDirectory cities={cities} stateSlug="ca" />
      </div>
    </div>
  );
}
