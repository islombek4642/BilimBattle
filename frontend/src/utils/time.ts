export function msToSeconds(ms: number): number {
  return Math.max(Math.ceil(ms / 1000), 0);
}
