import { expect, it } from 'vitest'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/remote-runtime/protocol/electron-remote-runtime-client-capabilities'
import { WEB_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/remote-runtime/protocol/web-runtime-client-capabilities'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import { botRequestCardBody } from '../../../../shared/bots/bot-request-card'
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import {
  createRestTestRig,
  REST_TEST_CALLER
} from '../../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig.test-fixture'
import {
  HOST_TEST_SESSION,
  hostTestAttachParams
} from '../../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import type { RpcDispatchStreamingOptions } from '../dispatch/dispatcher-stream-options'
import { RpcDispatcher } from '../dispatcher'
import { BOT_REQUEST_OUTCOME_METHOD } from './bots-request-outcome'

it('reads only the recorded outcome for the paired desktop viewing the sending card', async () => {
  const rig = await createRestTestRig()
  const db = new OrchestrationDb(':memory:')
  const folder: FolderWorkspace = {
    id: 'sender-home',
    projectGroupId: 'bots',
    name: 'Sender home',
    folderPath: rig.root,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
  let folderWorkspaces = [folder]
  const store = {
    getRepos: () => [],
    getProjectGroups: () => [],
    getFolderWorkspaces: () => folderWorkspaces
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: workspace admission only reads the folder catalog here.
  const runtime = new OrcaRuntimeService(store as unknown as RuntimeStore)
  runtime.setOrchestrationDb(db)
  setStructuredAgentSessionHost(rig.host)
  try {
    const attached = await rig.host.attach(
      REST_TEST_CALLER,
      hostTestAttachParams(null, {
        location: {
          workspaceId: folderWorkspaceKey(folder.id),
          workspaceKind: 'folder',
          executionHostId: 'local',
          wslDistro: null
        }
      })
    )
    if (!attached.ok) {
      throw new Error(attached.refusal.code)
    }
    const destination = await rig.host.captureAgentStartDestination(HOST_TEST_SESSION)
    if (!destination) {
      throw new Error('Missing sending chat')
    }
    const from = `orca_session_id:${HOST_TEST_SESSION}`
    const to = 'orca_session_id:recipient-chat'
    const threadId = 'local-thread'
    const request = db.admitBotRequest({
      rootKey: 'handoff',
      fromBotId: 'sender',
      toBotId: 'recipient',
      purpose: 'handoff',
      depth: 1,
      record: '{}',
      message: { from, to, subject: 'Handoff', type: 'handoff', threadId }
    })
    if (request.kind !== 'sent') {
      throw new Error('Handoff was not sent')
    }
    const { message } = request
    db.recordBotAnswer(message.id)
    db.insertMessage({
      from: to,
      to: from,
      subject: 'Re: Handoff',
      body: 'Private reply body',
      type: 'status',
      threadId,
      payload: JSON.stringify({ botAnswer: {}, requestId: message.id })
    })
    const peer = db.openHomePeerMailConversation({
      environmentId: 'client:peer/installation',
      peerFingerprint: 'peer',
      localParty: from,
      localPaneKey: null
    })
    db.insertPeerMailMessage({
      conversationId: peer.conversation_id,
      remoteParty: null,
      message: {
        id: 'returned-mail',
        from: 'Peer',
        to: from,
        subject: 'A peer reply',
        body: 'Returned peer text',
        type: 'status',
        threadId
      }
    })
    await rig.host.appendAgentStart(
      destination,
      {
        messageId: 'bot-request:card',
        body: botRequestCardBody({
          purpose: 'handoff',
          toBotId: 'recipient',
          toBotName: 'Recipient',
          messageId: message.id,
          subject: 'Handoff'
        })
      },
      rig.clock.now
    )
    const options: RpcDispatchStreamingOptions = {
      pairedDeviceId: 'desktop',
      clientKind: 'runtime',
      callerScope: { kind: 'runtime-paired', grants: [] },
      clientCapabilities: ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    }
    const dispatcher = new RpcDispatcher({ runtime, methods: [BOT_REQUEST_OUTCOME_METHOD] })
    const params = {
      messageId: message.id,
      sendingCard: {
        sessionId: HOST_TEST_SESSION,
        itemId: agentJournalSubmissionKey('bot-request:card')
      }
    }
    const read = (
      input: {
        messageId?: string
        sendingCard?: typeof params.sendingCard
        onClient?: boolean
      } = {},
      transport = options
    ) =>
      dispatcher.dispatch(
        {
          id: 'read',
          authToken: '',
          method: 'bots.request.outcome',
          params: { ...params, ...input }
        },
        transport
      )
    expect(await read()).toMatchObject({
      ok: true,
      result: { outcome: 'answered', answer: null, mailIds: [], chatId: null }
    })
    expect(
      await read({ sendingCard: { ...params.sendingCard, itemId: 'unrelated-card' } })
    ).toMatchObject({
      ok: true,
      result: { outcome: null, answer: null, mailIds: [], chatId: null }
    })
    expect(await read({ onClient: true })).toMatchObject({
      ok: true,
      result: { outcome: null, answer: null, mailIds: [], chatId: null }
    })
    expect(await read({ messageId: threadId, onClient: true })).toMatchObject({
      ok: true,
      result: {
        outcome: 'answered',
        answer: 'Returned peer text',
        mailIds: ['returned-mail'],
        chatId: null
      }
    })
    expect(
      await read({}, { ...options, clientCapabilities: WEB_RUNTIME_CLIENT_CAPABILITIES })
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    folderWorkspaces = []
    expect(await read()).toMatchObject({
      ok: true,
      result: { outcome: null, answer: null, mailIds: [], chatId: null }
    })
  } finally {
    setStructuredAgentSessionHost(null)
    db.close()
    await rig.dispose()
  }
})
