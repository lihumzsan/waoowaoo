import type { History } from '@temporalio/common/lib/proto-utils'

type HistoryEvent = NonNullable<History['events']>[number]

function eventIdKey(eventId: HistoryEvent['eventId']): string {
  return eventId?.toString() ?? ''
}

export function agentActivityAttempts(
  history: History,
  activityType: string,
): number[] {
  const scheduledTypes = new Map<string, string>()
  for (const event of history.events ?? []) {
    const attributes = event.activityTaskScheduledEventAttributes
    if (!attributes) continue
    scheduledTypes.set(
      eventIdKey(event.eventId),
      attributes.activityType?.name ?? '',
    )
  }
  const attempts: number[] = []
  for (const event of history.events ?? []) {
    const attributes = event.activityTaskStartedEventAttributes
    if (
      attributes
      && scheduledTypes.get(eventIdKey(attributes.scheduledEventId))
        === activityType
    ) {
      attempts.push(attributes.attempt ?? 0)
    }
  }
  return attempts
}

export function acceptedUpdateCount(
  history: History,
  updateId: string,
): number {
  return (history.events ?? []).filter(
    (event) =>
      event.workflowExecutionUpdateAcceptedEventAttributes
        ?.protocolInstanceId === updateId,
  ).length
}

function scheduledActivityIds(
  history: History,
  activityType: string,
): Set<string> {
  const ids = new Set<string>()
  for (const event of history.events ?? []) {
    if (
      event.activityTaskScheduledEventAttributes?.activityType?.name
      === activityType
    ) {
      ids.add(eventIdKey(event.eventId))
    }
  }
  return ids
}

export function scheduledActivityCount(
  history: History,
  activityType: string,
): number {
  return scheduledActivityIds(history, activityType).size
}

export function timedOutActivityCount(
  history: History,
  activityType: string,
): number {
  const scheduledIds = scheduledActivityIds(history, activityType)
  return (history.events ?? []).filter((event) => {
    const attributes = event.activityTaskTimedOutEventAttributes
    return (
      attributes
      && scheduledIds.has(eventIdKey(attributes.scheduledEventId))
    )
  }).length
}
