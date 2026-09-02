export function resolveSolutionDisplayLabel(
  customLabel: string | null | undefined,
  fallbackLabel: string,
): string {
  const trimmed = customLabel?.trim();
  return trimmed || fallbackLabel;
}
