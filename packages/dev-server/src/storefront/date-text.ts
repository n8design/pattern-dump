// A page's dates as text: `page.dateText` and the others, written in the site's language (site.lang) and style
// (site.dates).
//
// A date is a day, not a moment: `date: 2026-11-01` in frontmatter, or the author's day of a git date-time (%aI,
// whose first ten characters are the day in the author's own time zone). So the day is read off the text and
// formatted as that day in UTC, never through the machine's time zone: a build west of UTC would otherwise print
// the day before, and two machines would build two sites.

/** The style every site's dates have unless site.dates says otherwise. */
export const DEFAULT_DATES: Intl.DateTimeFormatOptions = { dateStyle: "long" };

/** Formats a day for the site. */
export type DateFormat = (iso: string) => string;

/**
 * A formatter for `lang` and `options`: it takes a `YYYY-MM-DD`, or a date-time whose first ten characters are one
 * (the day as written), and returns that day as text. A value that is no such day is returned as it is.
 */
export function dateFormatter(lang: string, options: Intl.DateTimeFormatOptions = DEFAULT_DATES): DateFormat {
  const format = new Intl.DateTimeFormat(lang, { ...options, timeZone: "UTC" });
  return iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    const day = new Date(0);
    day.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // not Date.UTC, which reads year 50 as 1950
    return format.format(day);
  };
}
