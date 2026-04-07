function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDefaultProjectTimestamp(date: Date): string {
  const month = padTwoDigits(date.getMonth() + 1)
  const day = padTwoDigits(date.getDate())
  const hours = padTwoDigits(date.getHours())
  const minutes = padTwoDigits(date.getMinutes())
  return `${month}-${day} ${hours}:${minutes}`
}
