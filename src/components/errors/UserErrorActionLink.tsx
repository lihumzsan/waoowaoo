'use client'

import type { UserErrorAction } from '@/lib/errors/projection'

export function UserErrorActionLink({
  action,
  className,
}: {
  readonly action: UserErrorAction
  readonly className?: string
}) {
  void action
  void className
  return null
}
