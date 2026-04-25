/**
 * Debe mantenerse alineado con `dashboard-data.js` (gastos fijos: fechaCobro ancla + legado).
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

function fixedExpClampDom(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, Math.floor(day)), last);
}

function fixedExpAtNoon(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

/**
 * @param {unknown} v
 * @returns {Date | null}
 */
function fixedExpenseParseFechaCobro(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : fixedExpAtNoon(v);
  if (typeof v === "object" && v !== null && typeof /** @type {{ toDate?: () => Date }} */ (v).toDate === "function") {
    try {
      const d = /** @type {{ toDate: () => Date }} */ (v).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? fixedExpAtNoon(d) : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const d = new Date(`${v.trim().slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : fixedExpAtNoon(d);
  }
  return null;
}

function fixedExpStepMonthly(anchorNoon) {
  const y = anchorNoon.getFullYear();
  const m = anchorNoon.getMonth();
  const day = anchorNoon.getDate();
  const nm = m + 1;
  const ny = nm > 11 ? y + 1 : y;
  const nmo = nm > 11 ? 0 : nm;
  const last = new Date(ny, nmo + 1, 0).getDate();
  const dom = Math.min(day, last);
  return fixedExpAtNoon(new Date(ny, nmo, dom, 12, 0, 0, 0));
}

function fixedExpStepWeekly(anchorNoon) {
  const x = new Date(anchorNoon);
  x.setDate(x.getDate() + 7);
  return fixedExpAtNoon(x);
}

function fixedExpAdvanceToOnOrAfter(anchorNoon, freq, rangeStartDay) {
  const target = fixedExpStartOfDay(rangeStartDay).getTime();
  let d = fixedExpAtNoon(new Date(anchorNoon));
  let guard = 0;
  while (d.getTime() < target && guard < 480) {
    guard += 1;
    d = freq === "weekly" ? fixedExpStepWeekly(d) : fixedExpStepMonthly(d);
  }
  return d;
}

/**
 * @param {Array<Record<string, unknown>>} rows
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
    const freq = String(raw.frequency || "monthly").toLowerCase() === "weekly" ? "weekly" : "monthly";
    const anchor = fixedExpenseParseFechaCobro(raw.fechaCobro);

    if (anchor) {
      let d = fixedExpAdvanceToOnOrAfter(anchor, freq, rs);
      let guard = 0;
      while (guard < 200) {
        guard += 1;
        if (d.getTime() > effectiveEnd.getTime()) break;
        if (d.getTime() >= rs.getTime() && d.getTime() <= re.getTime() && d.getTime() <= effectiveEnd.getTime()) {
          sum += amt;
        }
        d = freq === "weekly" ? fixedExpStepWeekly(d) : fixedExpStepMonthly(d);
      }
      continue;
    }

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
