export function buildCachedTargetOrder(songIds: number[], ratingKeys: Map<number, string>): string[] | null {
  const targetOrder: string[] = []
  for (const songId of songIds) {
    const ratingKey = ratingKeys.get(songId)
    if (!ratingKey) return null
    targetOrder.push(ratingKey)
  }
  return targetOrder
}
