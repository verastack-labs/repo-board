import type { Group } from './rows'

/** `1 failing · 2 unpushed · 1 dirty`, each part only when above zero; undefined clears the line. */
export function statusText(groups: readonly Group[]): string | undefined {
  let failing = 0
  let unpushed = 0
  let dirty = 0
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.pulls.some(pull => pull.checks === 'failing')) failing += 1
      if (row.local !== null && row.local.ahead > 0) unpushed += 1
      if (row.local !== null && row.local.changed > 0) dirty += 1
    }
  }
  const parts: string[] = []
  if (failing > 0) parts.push(`${failing} failing`)
  if (unpushed > 0) parts.push(`${unpushed} unpushed`)
  if (dirty > 0) parts.push(`${dirty} dirty`)
  return parts.length === 0 ? undefined : parts.join(' · ')
}
