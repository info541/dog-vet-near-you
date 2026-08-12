export function cityPath(stateSlug: string, citySlug: string): string {
  return `/${stateSlug}/${citySlug}`;
}

export function vetPath(
  stateSlug: string,
  citySlug: string,
  vetSlug: string,
): string {
  return `/${stateSlug}/${citySlug}/${vetSlug}`;
}
