// The navigation the product renders is the list of administration pages, so a new page is walked without editing this file.
export function adminLinks(testIds) {
  const links = [...new Set(testIds.filter((id) => typeof id === "string" && /^admin-.+-link$/.test(id)))];
  if (links.length === 0) throw new Error("the administration navigation offers no page");
  return links;
}
