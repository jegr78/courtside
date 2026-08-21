// FormData.get answers a File for a file input, so a plain String() would render "[object File]"
// into a request body without anything complaining.
export function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
