// The owner's own words on the message that opened a bot's turn, kept as its request's text. Read
// from Orca's records of the message, so never a teammate's, an automation's or Orca's own prompt.
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session/journal/agent-session-journal-types'
import { requestTextOf } from './bot-request-text'
import { typedInOrcaByOwner } from './bot-typed-in-orca'

/** A message Orca's record shows the owner typed at the host's own window; undefined for anything
 *  else, including a paired device and an automation's prompt (a bot can write one too, and Orca
 *  keeps no record of who did). */
export function ownerRequestOf(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): string | undefined {
  return (typedInOrcaByOwner(item, submissions) && requestTextOf(item.body)) || undefined
}
