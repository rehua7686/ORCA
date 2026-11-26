// Whether a message in a bot's chat is one a person typed in Orca, read from Orca's own record of the
// send: never Orca's own message (a continue after a restart or a usage limit), an agent's, an
// automation's or a connector delivery's.
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session/journal/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../shared/agent-session/journal/agent-session-journal-item-key'
import type { AgentJournalTypedBy } from '../../shared/agent-session/journal/agent-journal-typed-by'

/** Orca's record of the send that put this row in the chat; undefined for a row no send made. */
export const submissionOf = (
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): AgentJournalSubmission | undefined =>
  submissions.find(
    (submission) =>
      agentJournalSubmissionKey(submission.clientMessageId) === item.itemId ||
      submission.providerItemId === item.itemId
  )

function sentByPerson(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): boolean {
  const sent = submissionOf(item, submissions)
  // As the journal reads a personal send; Orca's continues name no sender and come from the host.
  // A queued card handed over says nothing of who queued it here, so it fails safe.
  return (
    sent !== undefined &&
    sent.queuedMessageId === undefined &&
    (sent.source?.kind === 'user' || (sent.source === undefined && sent.origin === 'client'))
  )
}

/** A person typed it in Orca: an automation's run or event, agent mail and deliveries are marked. */
export function typedInOrcaByPerson(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): boolean {
  const body = item.body
  return (
    body.kind === 'message' &&
    !body.from &&
    body.origin === undefined &&
    !body.asker &&
    !body.memorySource &&
    !body.automationRun &&
    // Sent by an agent through Orca (its CLI stamps it): never a person, whatever its source says.
    body.typedBy?.by !== 'agent' &&
    sentByPerson(item, submissions)
  )
}

/** Typed at the host's own window, as the host itself saw. A paired device's account is only what it
 *  declares, so even one matching the host's is not proof; no stamp, any device or an agent is not. */
export const typedByOwner = (typedBy: AgentJournalTypedBy | undefined): boolean =>
  typedBy?.by === 'host'

/** The owner typed it in Orca (typedByOwner), as a person's own send. */
export function typedInOrcaByOwner(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): boolean {
  return (
    typedByOwner(item.body.kind === 'message' ? item.body.typedBy : undefined) &&
    typedInOrcaByPerson(item, submissions)
  )
}

/** Typed on a paired device the host did not find on its own account (another account, or one it
 *  couldn't compare), by a person or by an agent's CLI over its pairing. Such a message never acts
 *  for the owner, whomever its conversation acts for. */
export function typedOnAnotherDevice(item: Pick<AgentJournalRenderItem, 'body'>): boolean {
  const typedBy = item.body.kind === 'message' ? item.body.typedBy : undefined
  return (
    (typedBy?.by === 'device' || (typedBy?.by === 'agent' && typedBy.deviceId !== undefined)) &&
    typedBy.own !== true
  )
}
