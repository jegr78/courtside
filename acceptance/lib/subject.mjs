/** Scrolls a capture's subject into the viewport and tells whether its top edge is visible there. */
export async function showSubject(subject, viewport) {
  await subject.scrollIntoViewIfNeeded();
  const box = await subject.boundingBox();
  if (!box || !viewport) return false;
  return box.y >= 0 && box.y < viewport.height;
}
