/** Accept only app-relative destinations after an auth callback. */
export function safeNextPath(path: string | null | undefined) {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  return path;
}

