export function dateInZone(instant, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
    .map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export function nextDateDelay(instant, timezone) {
  const today = dateInZone(instant, timezone)
  let low = instant, high = instant + 36 * 3600000
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2)
    if (dateInZone(middle, timezone) === today) low = middle
    else high = middle
  }
  return Math.max(1, high - instant)
}
