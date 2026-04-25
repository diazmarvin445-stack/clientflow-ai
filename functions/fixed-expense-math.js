/**
 * Misma lógica que `dashboard-data.js` (gastos fijos devengados) para usar en Cloud Functions.
 */

function fixedExpStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fixedExpEndOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * @param {number} year
 * @param {number} month 0-11
 * @param {number} day
 */
function fixedExpClampDom(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, Math.floor(day)), last);
}

/**
 * @param {Array<{ active?: boolean, amount?: unknown, frequency?: unknown, chargeDayOfMonth?: unknown, chargeWeekday?: unknown }>} rows
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @param {Date} asOfDate
 * @returns {number}
 */
export function sumAccruedFixedExpensesBetween(rows, rangeStart, rangeEnd, asOfDate) {
  const rs = fixedExpStartOfDay(rangeStart);
  const re = fixedExpEndOfDay(rangeEnd);
  const cap = fixedExpEndOfDay(asOfDate);
  const effectiveEnd = new Date(Math.min(re.getTime(), cap.getTime()));
  if (effectiveEnd.getTime() < rs.getTime()) return 0;

  let sum = 0;

  for (const raw of rows) {
    if (raw.active === false) continue;
    const amt = Number(raw.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const freq = String(raw.frequency || "monthly").toLowerCase();

    if (freq === "monthly") {
      const domRaw = raw.chargeDayOfMonth;
      const dClamped = Number.isFinite(Number(domRaw)) ? Math.min(31, Math.max(1, Math.floor(Number(domRaw)))) : 1;
      let y = rs.getFullYear();
      let m = rs.getMonth();
      const endY = effectiveEnd.getFullYear();
      const endM = effectiveEnd.getMonth();
      let guard = 0;
      while ((y < endY || (y === endY && m <= endM)) && guard < 36) {
        guard += 1;
        const dayUse = fixedExpClampDom(y, m, dClamped);
        const due = new Date(y, m, dayUse, 12, 0, 0, 0);
        if (due.getTime() >= rs.getTime() && due.getTime() <= effectiveEnd.getTime()) {
          sum += amt;
        }
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
    } else if (freq === "weekly") {
      const wdRaw = raw.chargeWeekday;
      const wd = Number.isFinite(Number(wdRaw)) ? Math.min(6, Math.max(0, Math.floor(Number(wdRaw)))) : 1;
      const d0 = fixedExpStartOfDay(new Date(rs));
      let d = new Date(d0);
      while (d.getTime() <= effectiveEnd.getTime()) {
        if (d.getTime() <= re.getTime() && d.getDay() === wd) {
          sum += amt;
        }
        d.setDate(d.getDate() + 1);
      }
    }
  }
  return sum;
}
