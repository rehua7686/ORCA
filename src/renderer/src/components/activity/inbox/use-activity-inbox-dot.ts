import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { createAgentStatusEpochSelector } from '@/lib/agent-status/evidence/agent-status-epoch-selector'
import { getAgentStatusEpochNow } from '@/lib/agent-status/evidence/agent-status-epoch-clock'
import { useBotsEnabled } from '@/lib/bot-catalog'
import { subscribeToBotChanges } from '@/lib/bot-catalog-snapshot'
import { useAccessRequests, type HostAccessRequest } from '@/lib/bot-access-requests'
import {
  hasActivityInboxAgentAttention,
  hasActivityInboxBotAttention,
  isLiveAccessRequest,
  nextAccessRequestExpiry
} from './activity-inbox'

const MAX_EXPIRY_TIMER_MS = 2 ** 31 - 1
// Small margin so Date.now() is strictly past expiresAt when the timer fires.
const EXPIRY_TIMER_MARGIN_MS = 50
const subscribeToNothing = (): (() => void) => () => {}

/** Arms one timer for the soonest unexpired access request so the dot and inbox drop it on expiry; idle when empty. */
export function useAccessRequestExpiryNow(
  requests: readonly HostAccessRequest[],
  enabled: boolean
): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled || requests.length === 0) {
      return
    }
    const current = Date.now()
    const hasNewlyExpired = requests.some(
      (request) => request.expiresAt > now && request.expiresAt <= current
    )
    const soonest = hasNewlyExpired ? null : nextAccessRequestExpiry(requests, current)
    const wait = hasNewlyExpired
      ? 0
      : soonest === null
        ? null
        : Math.min(Math.max(soonest - current, 0) + EXPIRY_TIMER_MARGIN_MS, MAX_EXPIRY_TIMER_MS)
    if (wait === null) {
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), wait)
    return () => clearTimeout(timer)
  }, [requests, enabled, now])
  return now
}

// Same-turn heartbeats keep the epoch, so they never rerun the scan; turn and freshness changes bump it.
const createAgentAttentionSelector = () =>
  createAgentStatusEpochSelector(
    (
      state: AppState,
      migrationUnsupportedByPtyId: AppState['migrationUnsupportedByPtyId'],
      acknowledgedAgentsByPaneKey: AppState['acknowledgedAgentsByPaneKey'],
      activityClearedAtByPaneKey: AppState['activityClearedAtByPaneKey'],
      runtimeAgentOrchestrationByPaneKey: AppState['runtimeAgentOrchestrationByPaneKey'],
      // Remote child contexts update projection.row(paneKey)?.entry without changing the local map.
      _remoteAgentOrchestrationByHost: AppState['remoteAgentOrchestrationByHost'],
      // Closing a tab can drop a pane's row without a status write.
      _rowOwnersRevision: number
    ) =>
      hasActivityInboxAgentAttention(
        {
          agentStatusByPaneKey: state.agentStatusByPaneKey,
          migrationUnsupportedByPtyId,
          acknowledgedAgentsByPaneKey,
          activityClearedAtByPaneKey,
          runtimeAgentOrchestrationByPaneKey
        },
        getAgentStatusEpochNow(state.agentStatusEpoch)
      )
  )

export type ActivityInboxAttention = {
  /** An agent waits on you, or has an outcome you haven't read. */
  agents: boolean
  /** A bot has items needing you, or someone asked for access. */
  bots: boolean
}

/** What the Activity inbox has for you. Reads only what the renderer already holds; never fetches. */
export function useActivityInboxAttention(): ActivityInboxAttention {
  const [selectAgentAttention] = useState(createAgentAttentionSelector)
  const agents = useAppStore((state) =>
    selectAgentAttention(
      state,
      state.migrationUnsupportedByPtyId,
      state.acknowledgedAgentsByPaneKey,
      state.activityClearedAtByPaneKey,
      state.runtimeAgentOrchestrationByPaneKey,
      state.remoteAgentOrchestrationByHost,
      state.agentStatusByPaneKey.projection.rowOwnersRevision()
    )
  )
  const botsEnabled = useBotsEnabled()
  const requests = useAccessRequests()
  const accessNow = useAccessRequestExpiryNow(requests, botsEnabled)
  // Never useBots(): it would start a bots.list. One boolean snapshot keeps unrelated bot writes from re-rendering the dot.
  const readBotAttention = useCallback((): boolean => {
    if (!botsEnabled) {
      return false
    }
    if (hasActivityInboxBotAttention()) {
      return true
    }
    if (requests.length === 0) {
      return false
    }
    return requests.some((request) => isLiveAccessRequest(request, accessNow))
  }, [botsEnabled, requests, accessNow])
  const bots = useSyncExternalStore(
    botsEnabled ? subscribeToBotChanges : subscribeToNothing,
    readBotAttention
  )
  return { agents, bots }
}

/** The rail's dot: anything at all in the inbox. */
export function useActivityInboxDot(): boolean {
  const { agents, bots } = useActivityInboxAttention()
  return agents || bots
}
