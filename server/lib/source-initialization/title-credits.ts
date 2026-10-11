/** Explicit annotations only; ordinary titles containing "with" remain untouched. */
export function parseTitleCredits(content: string): { contributors: string[]; production: boolean } | null {
  const clauses = content.trim().split(/[,，;；]\s*(?=(?:feat(?:uring)?|ft|with|w\/|vocals?|prod(?:uced)?|演唱|人声)(?:[.\s:：/]|by))/iu)
  const contributors: string[] = []
  let production = false
  for (const clause of clauses) {
    const text = clause.trim()
    const credit = text.match(/^(?:(?:feat(?:uring)?|ft)\.\s*|(?:feat(?:uring)?|ft|with)\s+|w\/\s*|(?:vocals?|演唱|人声)\s*[:：]\s*)(.+)$/iu)
    if (credit) { contributors.push(credit[1]!.trim()); continue }
    if (/^prod(?:uced)?(?:\.\s*(?:by\s*)?|\s+by\s+)\S/iu.test(text)) { production = true; continue }
    return null
  }
  return contributors.length ? {contributors,production} : null
}
