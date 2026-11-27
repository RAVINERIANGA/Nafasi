import { mutate } from "@/server/core/store";

const g = globalThis as typeof globalThis & { __nafasiTick?: ReturnType<typeof setInterval> };

if (!g.__nafasiTick) {
  g.__nafasiTick = setInterval(() => {
    mutate(() => undefined).catch(() => {});
  }, 1000);
}

export const tickStarted = true;
