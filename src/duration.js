/**
 * Calendar-aware duration utilities.
 *
 * Shared by !followage and !watchtime so duration math has ONE bug surface.
 * Replaces fixed 365/30-day decomposition, which produced day components that
 * were off by up to ±18 days in production (verified against Helix
 * followed_at timestamps captured in the 07/28-07/29 log window).
 *
 * All math is UTC. Months are anchored to real calendar dates: the month
 * count is the largest N such that (from + N calendar months) <= to, with
 * month-end clamping (Jan 31 + 1 month -> Feb 28/29).
 */

/** Add n calendar months to a Date (UTC), clamping to month end. */
function addUTCMonths(d, n) {
    const day = d.getUTCDate();
    const target = new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth() + n, 1,
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()
    ));
    const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, daysInMonth));
    return target;
}

/**
 * Calendar-accurate difference between two dates.
 * @param {Date} from - earlier date
 * @param {Date} to   - later date (defaults to now)
 * @returns {{years:number, months:number, days:number, hours:number, minutes:number, totalMs:number}}
 */
function calendarDiff(from, to = new Date()) {
    if (!(from instanceof Date) || isNaN(from)) throw new Error('calendarDiff: invalid from date');
    if (!(to instanceof Date) || isNaN(to)) throw new Error('calendarDiff: invalid to date');
    if (to < from) [from, to] = [to, from];

    // Largest whole-month count whose anchor does not overshoot `to`
    let totalMonths = (to.getUTCFullYear() - from.getUTCFullYear()) * 12
                    + (to.getUTCMonth() - from.getUTCMonth());
    if (addUTCMonths(from, totalMonths) > to) totalMonths--;
    if (totalMonths < 0) totalMonths = 0;

    const anchor = addUTCMonths(from, totalMonths);
    const remMs = to - anchor;
    const days = Math.floor(remMs / 86400000);
    const hours = Math.floor((remMs % 86400000) / 3600000);
    const minutes = Math.floor((remMs % 3600000) / 60000);

    return {
        years: Math.floor(totalMonths / 12),
        months: totalMonths % 12,
        days, hours, minutes,
        totalMs: to - from
    };
}

/**
 * Format a calendarDiff result the way chat expects: "1y 10m 2d", "22d", "5h".
 * Falls back to hours (then minutes) for sub-day durations.
 */
function formatDuration(diff) {
    let out = '';
    if (diff.years > 0) out += `${diff.years}y `;
    if (diff.months > 0) out += `${diff.months}m `;
    if (diff.days > 0) out += `${diff.days}d `;
    out = out.trim();
    if (!out) out = diff.hours > 0 ? `${diff.hours}h` : `${Math.max(diff.minutes, 1)}m`;
    return out;
}

/** Convenience: format minutes as "Xh Ym" (used by !watchtime). */
function formatMinutes(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = { calendarDiff, formatDuration, formatMinutes, addUTCMonths };
