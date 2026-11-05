// Old surge pricing, replaced by the pricing service in 2024. Nobody imports this anymore.
export function surgeMultiplier(demand: number, supply: number) {
  return Math.min(3, Math.max(1, demand / Math.max(1, supply)));
}
