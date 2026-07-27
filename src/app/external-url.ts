const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(value).protocol.toLowerCase());
  } catch {
    return false;
  }
}
