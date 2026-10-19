const queries = new Set<EventTarget>();
let fine = true;

export function anyFinePointerQuery(media: string): MediaQueryList {
  const query = new EventTarget() as MediaQueryList;
  Object.defineProperty(query, "matches", { get: () => fine });
  Object.defineProperty(query, "media", { get: () => media });
  queries.add(query);
  return query;
}

export function withFinePointer(present: boolean) {
  fine = present;
  queries.forEach((query) => query.dispatchEvent(new Event("change")));
}
