import type { WorktreeStatus } from '../../../../../../shared/worktree/row-display/worktree-status-rollup'

const LIVE_STATUS_OVER_UNREAD_BELL = new Set<WorktreeStatus>([
  'working',
  'monitoring',
  'permission'
])

/** True when active agent work or a pending approval prompt outranks a static unread bell. */
export function isLiveStatusOverUnreadBell(status: WorktreeStatus): boolean {
  return LIVE_STATUS_OVER_UNREAD_BELL.has(status)
}

export type ClassicStatusSlotMode =
  | 'live-status-with-unread-dot'
  | 'unread-bell'
  | 'status'
  | 'vm-state'
  | 'idle-bell'

/** Decide what the classic status toggle renders so live work stays visible while unread. */
export function resolveClassicStatusSlotMode({
  showStatus,
  isUnread,
  hasVmState,
  status
}: {
  showStatus: boolean
  isUnread: boolean
  hasVmState: boolean
  status: WorktreeStatus
}): ClassicStatusSlotMode {
  if (showStatus && !hasVmState && isUnread && isLiveStatusOverUnreadBell(status)) {
    return 'live-status-with-unread-dot'
  }
  if (isUnread) {
    return 'unread-bell'
  }
  if (showStatus) {
    return hasVmState ? 'vm-state' : 'status'
  }
  return 'idle-bell'
}
