const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Every operationId the API document declares, read straight from its paths, sorted. */
export function contractOperationIds(api) {
  return Object.values(api.paths ?? {})
    .flatMap((item) => HTTP_METHODS.filter((method) => item?.[method]).map((method) => item[method].operationId))
    .toSorted();
}
