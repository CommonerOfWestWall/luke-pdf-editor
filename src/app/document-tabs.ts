export function nextTabAfterClose(
  tabIds: readonly string[],
  closingId: string,
): string | null {
  const index = tabIds.indexOf(closingId);
  if (index < 0) return tabIds[0] ?? null;
  return tabIds[index + 1] ?? tabIds[index - 1] ?? null;
}
