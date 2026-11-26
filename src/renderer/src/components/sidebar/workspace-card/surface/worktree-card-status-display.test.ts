import { describe, expect, it } from 'vitest'
import {
  isLiveStatusOverUnreadBell,
  resolveClassicStatusSlotMode
} from './worktree-card-status-display'

describe('worktree-card-status-display', () => {
  it('shows live activity with an unread dot instead of replacing it with the unread bell', () => {
    for (const status of ['working', 'monitoring', 'permission'] as const) {
      expect(isLiveStatusOverUnreadBell(status)).toBe(true)
      expect(
        resolveClassicStatusSlotMode({
          showStatus: true,
          isUnread: true,
          hasVmState: false,
          status
        })
      ).toBe('live-status-with-unread-dot')
    }
  })

  it('keeps the static unread bell for settled states, hidden status, or inactive VMs', () => {
    for (const status of [
      'active',
      'done',
      'inactive',
      'failed',
      'interrupted',
      'unconfirmed'
    ] as const) {
      expect(isLiveStatusOverUnreadBell(status)).toBe(false)
      expect(
        resolveClassicStatusSlotMode({
          showStatus: true,
          isUnread: true,
          hasVmState: false,
          status
        })
      ).toBe('unread-bell')
    }

    expect(
      resolveClassicStatusSlotMode({
        showStatus: false,
        isUnread: true,
        hasVmState: false,
        status: 'working'
      })
    ).toBe('unread-bell')

    expect(
      resolveClassicStatusSlotMode({
        showStatus: true,
        isUnread: true,
        hasVmState: true,
        status: 'working'
      })
    ).toBe('unread-bell')
  })

  it('preserves read status and idle bell modes when unread is clear', () => {
    expect(
      resolveClassicStatusSlotMode({
        showStatus: true,
        isUnread: false,
        hasVmState: false,
        status: 'working'
      })
    ).toBe('status')

    expect(
      resolveClassicStatusSlotMode({
        showStatus: true,
        isUnread: false,
        hasVmState: true,
        status: 'inactive'
      })
    ).toBe('vm-state')

    expect(
      resolveClassicStatusSlotMode({
        showStatus: false,
        isUnread: false,
        hasVmState: false,
        status: 'done'
      })
    ).toBe('idle-bell')
  })
})
