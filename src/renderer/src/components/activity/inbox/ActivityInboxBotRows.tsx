// The bot side of the inbox: which bots have items for you, those items, and pending access requests.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { readBots, readLiveBotHostIds, subscribeToBotChanges } from '@/lib/bot-catalog-snapshot'
import { useAccessRequests, type HostAccessRequest } from '@/lib/bot-access-requests'
import { botRefKey } from '@/lib/bot-hosts'
import { useBotItems } from '@/components/bots/items/use-bot-items'
import type { Bot } from '../../../../../shared/bot-types'
import type { BotItem } from '../../../../../shared/bots/bot-items'
import { botItemGroupOf, botItemStaleDays } from '../../../../../shared/bots/bot-item-groups'
import { isLiveAccessRequest, readActivityInboxBots, type ActivityInboxBot } from './activity-inbox'
import { useAccessRequestExpiryNow } from './use-activity-inbox-dot'

const EMPTY_BOTS: ActivityInboxBot[] = []
const EMPTY_REQUESTS: HostAccessRequest[] = []
const NO_BOTS: readonly Bot[] = []
const NO_HOSTS: readonly never[] = []
const subscribeToNothing = (): (() => void) => () => {}
const readEmptyKey = (): string => ''
const readNoBots = (): readonly Bot[] => NO_BOTS
const readNoHosts = (): readonly never[] => NO_HOSTS

// A primitive key, so the external-store snapshot is stable between notifications.
function readBotsNeedingYouKey(): string {
  return readActivityInboxBots()
    .map(({ bot, count }) => `${bot.hostId}\u0000${bot.id}\u0000${count}`)
    .join('\u0001')
}

export type ActivityInboxBotSources = {
  /** Bots whose published count says items need you; only these have their items read. */
  bots: ActivityInboxBot[]
  requests: HostAccessRequest[]
}

/** From what the renderer already holds (no fetch): the bots to read items for, and access requests. */
export function useActivityInboxBotSources(enabled: boolean): ActivityInboxBotSources {
  const subscribe = enabled ? subscribeToBotChanges : subscribeToNothing
  const botsKey = useSyncExternalStore(subscribe, enabled ? readBotsNeedingYouKey : readEmptyKey)
  // The bot list's identity too, so a renamed bot or a changed itemsStale reaches the rows.
  const allBots = useSyncExternalStore(subscribe, enabled ? readBots : readNoBots)
  const liveHosts = useSyncExternalStore(subscribe, enabled ? readLiveBotHostIds : readNoHosts)
  const bots = useMemo(
    () => (enabled && botsKey ? readActivityInboxBots(allBots) : EMPTY_BOTS),
    [enabled, botsKey, allBots]
  )
  const allRequests = useAccessRequests()
  const accessNow = useAccessRequestExpiryNow(allRequests, enabled)
  const requests = useMemo(() => {
    if (!enabled || allRequests.length === 0) {
      return EMPTY_REQUESTS
    }
    return allRequests.filter((request) =>
      isLiveAccessRequest(request, accessNow, allBots, liveHosts)
    )
  }, [enabled, allRequests, liveHosts, allBots, accessNow])
  return { bots, requests }
}

/** A bot's items in Needs you, as its Items tab groups them; null until its list has been read. */
export type BotItemsNeedingYou = { bot: Bot; items: BotItem[] | null }

/**
 * Reads one bot's items while Activity is open, through the same shared read as its Items tab (one read per
 * bot, re-read on its notices), and reports those in Needs you. Renders nothing.
 */
export function ActivityInboxBotItemsReader({
  bot,
  count,
  onItems
}: {
  bot: Bot
  /** Published Needs you count; changing (e.g. an item going stale) re-runs the staleness filter. */
  count: number
  onItems: (key: string, value: BotItemsNeedingYou | undefined) => void
}): null {
  const { read, state, landed, refreshFailed } = useBotItems(bot)
  const key = botRefKey(bot)
  useEffect(() => {
    // Grouped as the list lands (staleness reads the clock), not during render.
    const staleDays = botItemStaleDays(bot.itemsStale)
    const now = Date.now()
    const needsYou = read
      ? read.items.filter((item) => botItemGroupOf(item, staleDays, now) === 'needs_you')
      : null
    // A kept list with 0 items predates the new count: wait for the fresh read to land (or fail) before settling empty.
    const items =
      needsYou && needsYou.length > 0
        ? needsYou
        : landed || refreshFailed || state === 'failed'
          ? (needsYou ?? [])
          : null
    onItems(key, { bot, items })
  }, [key, bot, count, read, state, landed, refreshFailed, onItems])
  useEffect(() => () => onItems(key, undefined), [key, onItems])
  return null
}
