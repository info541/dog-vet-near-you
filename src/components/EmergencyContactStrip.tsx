import Link from "next/link";
import type { VetListing } from "@/data/types";
import { telHref } from "@/lib/vets";

function hasCallablePhone(phone: string | undefined): boolean {
  const value = (phone || "").trim();
  if (!value) return false;
  if (value.toLowerCase() === "call for number") return false;
  return /\d{3}/.test(value);
}

function labelFor(vet: VetListing): string {
  return vet.shortName?.trim() || vet.name;
}

export function EmergencyContactStrip({
  vets,
  cityName,
  emergencyProfileHref,
}: {
  vets: VetListing[];
  cityName: string;
  emergencyProfileHref?: string;
}) {
  const emergency = vets.filter(
    (v) =>
      (v.is24_7 || v.careType === "24/7 Emergency") && hasCallablePhone(v.phone),
  );
  const urgent = vets.filter(
    (v) => v.careType === "Urgent Care" && hasCallablePhone(v.phone),
  );
  const withPhones = vets.filter((v) => hasCallablePhone(v.phone));

  const contacts =
    emergency.length > 0
      ? emergency.slice(0, 3)
      : urgent.length > 0
        ? urgent.slice(0, 3)
        : withPhones.slice(0, 3);

  if (!contacts.length) return null;

  const isEmergency = emergency.length > 0;
  const heading = isEmergency
    ? "Need help now?"
    : urgent.length > 0
      ? "Urgent care contacts"
      : `Call a ${cityName} clinic`;

  return (
    <aside className="emergency-strip" id="emergency">
      <p>
        {heading}{" "}
        {contacts.map((v, i) => (
          <span key={v.slug}>
            {i > 0 ? " · " : null}
            <a href={telHref(v.phone)}>{`${labelFor(v)}: ${v.phone}`}</a>
          </span>
        ))}
      </p>
      {isEmergency && emergencyProfileHref ? (
        <Link className="btn btn-emergency" href={emergencyProfileHref}>
          Emergency profile
        </Link>
      ) : (
        <a className="btn btn-emergency" href={telHref(contacts[0].phone)}>
          Call {contacts[0].phone}
        </a>
      )}
    </aside>
  );
}
