export interface LookupRow {
  impact: number;
  urgency: number;
  priority: number;
  order: number;
}

export interface PdPriorityInput {
  id: string;
  name: string;
  /** PagerDuty's ordering weight: a bigger number is a more severe priority (P1 is the largest). */
  order: number;
}

export interface PriorityAssignment {
  pdPriorityId: string;
  pdPriorityName: string;
  impact: number;
  urgency: number;
  /** The ServiceNow priority ServiceNow's own lookup rules will derive from impact + urgency. */
  snPriority: number;
}

const byBalance = (a: LookupRow, b: LookupRow) =>
  Math.abs(a.impact - a.urgency) - Math.abs(b.impact - b.urgency) || a.impact + a.urgency - (b.impact + b.urgency) || a.order - b.order;

const bySeverity = (a: LookupRow, b: LookupRow) =>
  a.impact + a.urgency - (b.impact + b.urgency) || Math.abs(a.impact - a.urgency) - Math.abs(b.impact - b.urgency) || a.order - b.order;

/**
 * Picks an Impact/Urgency pair for every PagerDuty priority so that
 * ServiceNow's own Priority Lookup Rules turn it into the matching ServiceNow
 * priority. Rather than hardcoding a table, it reads the instance's real
 * lookup rows (which differ between releases and can be customised):
 *
 *  - PagerDuty priorities are ranked most → least severe and walked down
 *    ServiceNow's available priority levels (P1 → level 1, P2 → level 2, ...);
 *    default-style names (P1..P5) use their own number as the target level.
 *  - If there are more PagerDuty priorities than ServiceNow levels, the extras
 *    share the last level but still get distinct pairs, least severe last.
 *  - Within a level the most balanced pair wins (impact == urgency when the
 *    lookup has one), since a balanced pair reads as the "typical" case.
 */
export function mapPriorities(pdPriorities: PdPriorityInput[], lookup: LookupRow[]): PriorityAssignment[] {
  const rows = lookup.filter((r) => Number.isFinite(r.priority));
  if (rows.length === 0 || pdPriorities.length === 0) return [];

  const ranked = [...pdPriorities].sort((a, b) => b.order - a.order);
  const levels = [...new Set(rows.map((r) => r.priority))].sort((a, b) => a - b);

  // PagerDuty's defaults are literally named P1..P5, so when every name carries
  // a distinct number use it as the target level; otherwise fall back to rank.
  const digits = ranked.map((p) => Number(p.name.trim().match(/^P?(\d)$/i)?.[1]));
  const namedByNumber = digits.every((d) => d >= 1) && new Set(digits).size === digits.length;

  const groups = new Map<number, PdPriorityInput[]>();
  ranked.forEach((p, i) => {
    const rank = namedByNumber ? digits[i] - 1 : i;
    const level = levels[Math.min(rank, levels.length - 1)];
    groups.set(level, [...(groups.get(level) ?? []), p]);
  });

  const assignments: PriorityAssignment[] = [];
  for (const [level, members] of groups) {
    const pairs = rows.filter((r) => r.priority === level);
    const chosen: LookupRow[] = [];
    if (members.length === 1) {
      chosen.push([...pairs].sort(byBalance)[0]);
    } else {
      const ordered = [...pairs].sort(bySeverity);
      members.forEach((_, j) => {
        chosen.push(ordered[Math.round((j * (ordered.length - 1)) / (members.length - 1))]);
      });
    }
    members.forEach((p, j) =>
      assignments.push({
        pdPriorityId: p.id,
        pdPriorityName: p.name,
        impact: chosen[j].impact,
        urgency: chosen[j].urgency,
        snPriority: level,
      }),
    );
  }
  return ranked.map((p) => assignments.find((a) => a.pdPriorityId === p.id)!);
}
