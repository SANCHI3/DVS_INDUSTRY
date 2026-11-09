/**
 * The plant calendar, as the website shows it. The plant's weekly off is
 * SATURDAY; Sunday is a normal working day. The backend setting
 * PLANT_WEEKLY_OFF (backend/src/config/plant.ts) decides the numbers; this
 * only labels the choices in forms.
 */

/** Index = weekday number (0 = Sunday … 6 = Saturday), as the API sends it. */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const PLANT_WEEKLY_OFF_DAY = 6;
export const PLANT_WEEKLY_OFF_LABEL = WEEKDAY_NAMES[PLANT_WEEKLY_OFF_DAY];

/** An employee's weekly off in words: their own, else the plant's. */
export function weeklyOffText(weeklyOffDay: number | null | undefined): string {
  return weeklyOffDay === null || weeklyOffDay === undefined || !WEEKDAY_NAMES[weeklyOffDay]
    ? `${PLANT_WEEKLY_OFF_LABEL} (plant weekly off)`
    : WEEKDAY_NAMES[weeklyOffDay];
}
