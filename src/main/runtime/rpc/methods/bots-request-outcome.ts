// How a bot request a card in the owner's chat names has ended, and its answer, from Orca's record.
import { BotRequestOutcomeParams } from '../../../../shared/rpc-contract/bots-look-around-params'
import { BOT_REQUEST_CARD_STATUS_CLIENT_CAPABILITY } from '../../../../shared/agent-session/capabilities/agent-session-runtime-capabilities'
import {
  botRequestCardOf,
  type BotRequestCardReading
} from '../../../../shared/bots/bot-request-card'
import {
  isOrcaSessionId,
  parseOrcaSessionAddress
} from '../../../../shared/agent-session/identity/orca-session-address'
import { agentSessionExecutionLocationsEqual } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { defineMethod, InvalidArgumentError, type RpcContext } from '../core'
import { canonicalOrcaSessionId } from '../../orchestration/addressing/session-lineage/canonical-orca-session-id'
import { StructuredWorkspaceUnavailable } from '../../session-tabs/chat/structured-workspace-authority'
import { isBotAnswerTo } from './orchestration/messaging/bot-request-outcome'
import { readClientAskOutcome } from './orchestration/messaging/client-ask-card'
import { requireInstalledStructuredHost } from './structured-sessions/creation/structured-agent-session-gate'

const EMPTY_READING: BotRequestCardReading = {
  outcome: null,
  answer: null,
  mailIds: [],
  chatId: null
}

async function readPairedOutcome(
  ctx: RpcContext,
  messageId: string,
  { sessionId, itemId }: { sessionId: string; itemId: string }
): Promise<BotRequestCardReading> {
  if (!isOrcaSessionId(sessionId)) {
    return EMPTY_READING
  }
  const host = await requireInstalledStructuredHost(ctx, sessionId)
  const location = host.attentionReads.sessionLocation(sessionId)
  if (!location) {
    return EMPTY_READING
  }
  try {
    const workspace = await ctx.runtime.prepareStructuredAgentSessionRevealWorkspace(location)
    try {
      const card = await host.historyItem(sessionId, itemId)
      const current = host.attentionReads.sessionLocation(sessionId)
      if (
        !current ||
        !agentSessionExecutionLocationsEqual(current, location) ||
        !workspace.current() ||
        !card ||
        botRequestCardOf(card.body)?.messageId !== messageId
      ) {
        return EMPTY_READING
      }
      const db = ctx.runtime.getOrchestrationDb()
      const sender = parseOrcaSessionAddress(db.getMessageById(messageId)?.from_handle)
      if (sender !== canonicalOrcaSessionId(sessionId)) {
        return EMPTY_READING
      }
      // The paired card only needs enough information to stop showing the request as pending.
      return { ...EMPTY_READING, outcome: db.getBotRequestOutcome(messageId) }
    } finally {
      workspace.release()
    }
  } catch (error) {
    if (error instanceof StructuredWorkspaceUnavailable) {
      return EMPTY_READING
    }
    throw error
  }
}

export const BOT_REQUEST_OUTCOME_METHOD = defineMethod({
  name: 'bots.request.outcome',
  permission: 'workspace',
  params: BotRequestOutcomeParams,
  handler: ({ messageId, onClient, sendingCard }, ctx) => {
    const { runtime, pairedDeviceId, callerScope, caller } = ctx
    const needsPairedScope = pairedDeviceId !== undefined && callerScope?.kind !== 'mobile'
    // Any window showing the asking chat reads it: what it says is that chat's own mail.
    if (onClient) {
      const db = runtime.getOrchestrationDb()
      return needsPairedScope && db.getBotRequest(messageId)
        ? EMPTY_READING
        : readClientAskOutcome(db, messageId, needsPairedScope)
    }
    if (needsPairedScope) {
      if (
        callerScope?.kind === 'runtime-paired' &&
        ctx.clientKind === 'runtime' &&
        caller?.kind === 'paired-device' &&
        !caller.agent &&
        ctx.clientCapabilities?.includes(BOT_REQUEST_CARD_STATUS_CLIENT_CAPABILITY) &&
        sendingCard
      ) {
        return readPairedOutcome(ctx, messageId, sendingCard)
      }
      throw new InvalidArgumentError('Bot requests are read on the computer that runs the bots.')
    }
    const db = runtime.getOrchestrationDb()
    const request = db.getBotRequest(messageId) ? db.getMessageById(messageId) : undefined
    if (!request) {
      return EMPTY_READING
    }
    // The mail notice in the sender's chat only points at the mail; the card shows the answer itself,
    // and names the mail so the chat folds those notices into it.
    const replies = db.getThreadMessagesFor(request.thread_id ?? request.id, request.from_handle)
    const answer = replies.find((reply) => isBotAnswerTo(reply.payload, messageId))
    return {
      outcome: db.getBotRequestOutcome(messageId),
      answer: answer?.body ?? null,
      mailIds: replies.map((reply) => reply.id),
      // A request is mailed to the chat it runs in: the bot's Chat, a named one, or one made for it.
      chatId: parseOrcaSessionAddress(request.to_handle)
    }
  }
})
