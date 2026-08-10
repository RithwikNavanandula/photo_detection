/** Convert legacy scanner dates into the YYYY-MM-DD format required by date inputs. */
export function toDateInputValue(value?: string | null): string {
  if (!value) return "";

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;

  const dayFirst = value.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (!dayFirst) return "";

  const [, day, month, year] = dayFirst;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
