const messageLimit = 200;

export function failureReason(failure) {
  const error = Error.isError(failure);
  const name = error ? String(failure.name) : failure === null ? "null" : typeof failure;
  const text = error ? String(failure.message ?? "") : failure === undefined || failure === null ? "" : String(failure);
  return { name, message: text.length > messageLimit ? `${text.slice(0, messageLimit)}…` : text };
}

export async function attemptStep(failures, key, action) {
  try {
    return await action();
  } catch (failure) {
    failures[key] = failureReason(failure);
    return undefined;
  }
}

export function failureCode(failure) {
  const message = Error.isError(failure) ? failure.message : undefined;
  return typeof message === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(message) && message.length <= 64
    ? message : failureReason(failure).name;
}
