// frontend/src/utils/time.ts
export function msToSeconds(ms: number): number {
  return Math.max(Math.ceil(ms / 1000), 0);
}
