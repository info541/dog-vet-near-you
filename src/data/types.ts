export type CareType =
  | "24/7 Emergency"
  | "Urgent Care"
  | "General Practice"
  | "Specialty";

export type Review = {
  author: string;
  rating: number;
  text: string;
  source: string;
  date?: string;
};

export type VetListing = {
  slug: string;
  name: string;
  shortName?: string;
  careType: CareType;
  is24_7: boolean;
  priority: number;
  description: string;
  phone: string;
  phoneSecondary?: string;
  email?: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  neighborhood?: string;
  hours: string;
  hoursDetail?: string[];
  rating: number;
  reviewCount: number;
  services: string[];
  highlights: string[];
  acceptsDogs: boolean;
  reviews: Review[];
  /** Optional Places/API provenance */
  placeId?: string;
  sourceUpdatedAt?: string;
};

export type CityStatus = "live" | "pending";

export type CityRecord = {
  name: string;
  slug: string;
  type: "city" | "town";
  county: string;
  population: number;
  state: string;
  stateSlug: string;
  status: CityStatus;
  tagline?: string;
  description?: string;
};

export type StateRecord = {
  name: string;
  slug: string;
  abbreviation: string;
  cityCount: number;
  liveCityCount: number;
};
