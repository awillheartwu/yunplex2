/** Historical run summaries stay immutable; only their retired wording changes. */
export function presentRunSummary(summary: string): string {
  return summary.replace(/(\d+)\s*首已忽略/g, '$1 首需关注')
}
