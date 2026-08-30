export * from "./types";
export * from "./schemas";

/** API paths, relative to the mount point of the handler. */
export const API_PATHS = {
  config: "config",
  session: "session",
  asset: (id: string) => `${id}/asset`,
  submit: (id: string) => `${id}/submit`,
  status: (id: string) => id,
} as const;

/** Simple stable hash (FNV-1a, hex) used for consent text hashing. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
