// Fiscal-quarter helper for Revenue Reports.
//
// The company's fiscal year starts in July:
//   Q1 = Jul · Aug · Sep      Q2 = Oct · Nov · Dec
//   Q3 = Jan · Feb · Mar      Q4 = Apr · May · Jun   (of the next calendar year)
//
// Billing rule: an org is billed for a whole quarter unless it was created
// mid-quarter, in which case only the remaining months of that quarter count —
// EXCEPT that an org created after the 15th of the quarter's LAST month rolls
// over to the next quarter entirely (3 billable months there).
//
// Examples (fiscal Q1 = Jul–Sep):
//   created in July           → Q1, 3 billable months
//   created Aug 10            → Q1, 2 billable months (Aug, Sep)
//   created Sep 20 (>15 cut)  → Q2, 3 billable months (Oct, Nov, Dec)

export type FiscalQuarter = 1 | 2 | 3 | 4

export interface QuarterDef {
  key: string // e.g. "Q1-2026"
  label: string // e.g. "Q1 2026"
  fq: FiscalQuarter
  fiscalYear: number // the calendar year the fiscal year is labelled by (Q1/Q2 share it)
  months: number[] // 0-indexed calendar month numbers, in order
  monthYears: number[] // calendar year for each month in `months`
}

// Last 0-indexed month of each fiscal quarter.
const LAST_MONTH: Record<FiscalQuarter, number> = { 1: 8 /*Sep*/, 2: 11 /*Dec*/, 3: 2 /*Mar*/, 4: 5 /*Jun*/ }

// Map a Date to its fiscal quarter + the fiscal-year label.
function fiscalOf(date: Date): { fq: FiscalQuarter; fiscalYear: number } {
  const m = date.getMonth()
  const y = date.getFullYear()
  if (m >= 6 && m <= 8) return { fq: 1, fiscalYear: y }
  if (m >= 9 && m <= 11) return { fq: 2, fiscalYear: y }
  if (m >= 0 && m <= 2) return { fq: 3, fiscalYear: y - 1 }
  return { fq: 4, fiscalYear: y - 1 } // Apr–Jun
}

// A strictly-increasing ordinal so quarters can be compared/sorted.
export function quarterOrdinal(fq: FiscalQuarter, fiscalYear: number): number {
  return fiscalYear * 4 + (fq - 1)
}

// Build a QuarterDef from a fiscal quarter + fiscal year.
export function quarterDef(fq: FiscalQuarter, fiscalYear: number): QuarterDef {
  const spec: Record<FiscalQuarter, { months: number[]; yearOffset: number[] }> = {
    1: { months: [6, 7, 8], yearOffset: [0, 0, 0] },
    2: { months: [9, 10, 11], yearOffset: [0, 0, 0] },
    3: { months: [0, 1, 2], yearOffset: [1, 1, 1] },
    4: { months: [3, 4, 5], yearOffset: [1, 1, 1] },
  }
  const s = spec[fq]
  return {
    key: `Q${fq}-${fiscalYear}`,
    label: `Q${fq} ${fiscalYear}`,
    fq,
    fiscalYear,
    months: s.months,
    monthYears: s.yearOffset.map(o => fiscalYear + o),
  }
}

export interface QuarterBilling {
  billsThisQuarter: boolean // does this org contribute revenue in the target quarter?
  isNew: boolean // was the org first billed in the target quarter?
  billableMonths: number // months billed within the target quarter
}

/**
 * Given an org's creation date, compute how it bills in a target fiscal quarter.
 *
 * @param createdAt   org creation/sale date
 * @param targetFq    fiscal quarter being reported on
 * @param targetYear  fiscal year label of the target quarter
 * @param isActive    whether the org is still active (existing orgs keep billing)
 */
export function billingForQuarter(
  createdAt: Date,
  targetFq: FiscalQuarter,
  targetYear: number,
  isActive: boolean
): QuarterBilling {
  const targetOrd = quarterOrdinal(targetFq, targetYear)

  // The org's effective first-billing quarter, applying the day-15 rollover.
  const { fq: rawFq, fiscalYear: rawYear } = fiscalOf(createdAt)
  const rawOrd = quarterOrdinal(rawFq, rawYear)
  const lastMonth = LAST_MONTH[rawFq]
  const rolledOver = createdAt.getMonth() === lastMonth && createdAt.getDate() > 15
  const effOrd = rolledOver ? rawOrd + 1 : rawOrd

  // Billable months if this IS the first quarter the org bills in.
  const monthsInFirstQuarter = rolledOver
    ? 3
    : (lastMonth - createdAt.getMonth()) + 1

  if (effOrd === targetOrd) {
    return { billsThisQuarter: true, isNew: true, billableMonths: monthsInFirstQuarter }
  }
  if (effOrd < targetOrd) {
    // Sold in a previous quarter — keeps billing the full quarter while active.
    return { billsThisQuarter: isActive, isNew: false, billableMonths: isActive ? 3 : 0 }
  }
  // Sold in a later quarter — not billing yet in the target quarter.
  return { billsThisQuarter: false, isNew: false, billableMonths: 0 }
}
