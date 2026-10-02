// The calendar day the user is looking at, shared with the global "+" button so a new
// entry lands on that day instead of today. Cleared when the calendar unmounts.

const KEY = "finnos:selected-day";

export function setSelectedDay(date: string | null): void {
  if (date) window.sessionStorage.setItem(KEY, date);
  else window.sessionStorage.removeItem(KEY);
}

export function getSelectedDay(): string | null {
  return window.sessionStorage.getItem(KEY);
}
