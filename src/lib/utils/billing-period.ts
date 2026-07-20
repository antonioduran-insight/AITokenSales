// Billing-period helpers.
//
// The org's lead quota renews on its `billing_day` (the day of the month the org
// was registered), NOT on calendar month boundaries. Example: billing_day = 23,
// today = July 15 → the current period started June 23 and ends July 22 (the
// period is [start, end) where `end` is exclusive, i.e. the next renewal day).

export interface BillingPeriod {
  start: Date // inclusive
  end: Date // exclusive (next renewal)
}

// Number of days in the given year/month (month is 0-indexed).
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Clamp the billing day to a valid day for the given month (e.g. a billing_day
// of 31 becomes 30 in a 30-day month, or 28/29 in February).
function clampDay(year: number, month: number, day: number): number {
  return Math.min(Math.max(day, 1), daysInMonth(year, month))
}

/**
 * Compute the billing period that `now` falls within, given the org's billing_day.
 */
export function currentBillingPeriod(billingDay: number, now: Date = new Date()): BillingPeriod {
  const day = Number.isFinite(billingDay) && billingDay >= 1 ? Math.floor(billingDay) : 1
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()

  // Renewal day for the current calendar month.
  const thisMonthRenewal = clampDay(y, m, day)

  // If we're on/after this month's renewal day, the period started this month;
  // otherwise it started on the previous month's renewal day.
  let startYear = y
  let startMonth = m
  if (d < thisMonthRenewal) {
    startMonth = m - 1
    if (startMonth < 0) { startMonth = 11; startYear = y - 1 }
  }

  const start = new Date(startYear, startMonth, clampDay(startYear, startMonth, day))

  let endYear = startYear
  let endMonth = startMonth + 1
  if (endMonth > 11) { endMonth = 0; endYear = startYear + 1 }
  const end = new Date(endYear, endMonth, clampDay(endYear, endMonth, day))

  return { start, end }
}
