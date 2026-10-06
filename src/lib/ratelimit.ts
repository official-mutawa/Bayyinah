// Simple per-instance sliding-window rate limit per IP, shared by the API routes.
// A question uses two calls (/api/queries then /api/ask).

const WINDOWS = [
  { ms: 60_000, max: 16 },
  { ms: 3_600_000, max: 80 },
];
const hits = new Map<string, number[]>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOWS[WINDOWS.length - 1].ms);
  const blocked = WINDOWS.some((w) => list.filter((t) => now - t < w.ms).length >= w.max);
  if (!blocked) list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return blocked;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
