import '../../../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot } from '../../../../../../shared/bot-types'
import { BotItemsStore } from '../../../../../bots/bot-items-store'
import { AgentSessionAttachmentStore } from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-store'
import {
  agentSessionAttachmentReferences,
  agentSessionAttachmentStoreRoot
} from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-references'
import { setAgentSessionAttachmentStore } from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-store-registry'
import type { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import type * as RecipientRouting from './recipient-routing'
import {
  DOCS_CHAT,
  journals,
  message,
  notes,
  RANGER_THREAD,
  setupBotMail
} from './bot-recipient.test-fixture'

vi.mock(
  '../../../../../bots/bot-session-tabs',
  async () => (await import('./bot-recipient.test-fixture')).botSessionTabsMock
)
vi.mock(
  '../../../../../bots/bot-chat-session',
  async () => (await import('./bot-recipient.test-fixture')).botChatSessionMock
)
vi.mock(
  '../../../../../bots/bot-chat-mail-hold',
  async () => (await import('./bot-recipient.test-fixture')).botChatMailHoldMock
)
vi.mock(
  '../../../../../bots/bot-chat-status-line',
  async () => (await import('./bot-recipient.test-fixture')).botChatStatusLineMock
)
vi.mock('./recipient-routing', async (importOriginal) =>
  (await import('./bot-recipient.test-fixture')).recipientRoutingMock(
    await importOriginal<typeof RecipientRouting>()
  )
)
// The item's chat is Docs' Home Chat, live on this host.
vi.mock('../../bots-chats', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  botChatTakingMail: async () => ({ title: null, sessionId: DOCS_CHAT })
}))

// A 1x1 PNG, so the image is admitted as an inline image block.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe("an item's files sent to another bot", () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let bots: Bot[]
  let send: ReturnType<typeof setupBotMail>['send']
  let sent: ReturnType<typeof setupBotMail>['sent']
  let root: string
  let uploads: string
  let store: AgentSessionAttachmentStore
  let items: BotItemsStore
  /** The claims the journal holds, as `upload:session`. */
  const claims = new Set<string>()
  /** Run when a claim is taken: the target paused while the files were being claimed. */
  let onClaim: () => void = () => {}

  beforeEach(() => {
    ;({ db, runtime, bots, send, sent } = setupBotMail(h))
    root = mkdtempSync(join(tmpdir(), 'orca-item-mail-limits-'))
    // The store's own root: only paths under it are uploads its claims and sweep read.
    uploads = agentSessionAttachmentStoreRoot(root)
    mkdirSync(uploads)
    store = new AgentSessionAttachmentStore(uploads, { hasSession: () => true })
    claims.clear()
    onClaim = () => {}
    setAgentSessionAttachmentStore(
      store,
      async (sessionId, body) => {
        for (const uploadId of agentSessionAttachmentReferences(uploads, body)) {
          claims.add(`${uploadId}:${sessionId}`)
        }
        onClaim()
      },
      // As the journal's prune: a claim goes only once its upload's folder has.
      async (pairs) => {
        for (const { uploadId, sessionId } of pairs) {
          if (!existsSync(join(uploads, uploadId))) {
            claims.delete(`${uploadId}:${sessionId}`)
          }
        }
      }
    )
    items = BotItemsStore.open(':memory:')
    const docsHome = { kind: 'bot', botId: 'docs', chatId: DOCS_CHAT } as const
    items.add(
      {
        ownerBotId: 'docs',
        chatId: DOCS_CHAT,
        source: { kind: 'home', title: null },
        title: 'Install guide',
        status: 'working',
        links: []
      },
      docsHome
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: item mail reads only byNumber and get of the store.
    const remote = items as unknown as ReturnType<typeof runtime.botItems.store>
    vi.spyOn(runtime.botItems, 'store').mockReturnValue(remote)
    vi.spyOn(runtime.botItems, 'owningChat').mockReturnValue({
      id: DOCS_CHAT,
      kind: 'home',
      title: null
    })
    journals[RANGER_THREAD] = [message('ask')]
  })
  afterEach(() => {
    setAgentSessionAttachmentStore(null)
    items.dispose()
    rmSync(root, { recursive: true, force: true })
    h.cleanup()
  })

  /** Ranger's requests to Docs already in this window. */
  const alreadySent = (count: number) => {
    for (let request = 0; request < count; request += 1) {
      db.reserveBotRequest({
        messageId: `msg_earlier_${request}`,
        rootKey: 'earlier',
        fromBotId: 'ranger',
        toBotId: 'docs',
        purpose: 'status',
        depth: 1,
        record: '{}'
      })
    }
  }
  const toDocs = () => db.botRequestsSentWithin({ fromBotId: 'ranger', toBotId: 'docs' }, 10).count
  const mailToDocs = () => {
    const row = db.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE to_handle = ?')
      .get(`orca_session_id:${DOCS_CHAT}`)
    return typeof row === 'object' && row !== null && 'n' in row ? Number(row.n) : 0
  }
  const uploadFolders = () =>
    readdirSync(uploads, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  /** A file on this computer, outside the store: each send copies it in. */
  const outside = (name: string, bytes: string | Buffer = 'release notes draft') => {
    const file = join(root, name)
    writeFileSync(file, bytes)
    return file
  }
  const question = (subject: string, files: string[]) => ({
    to: 'bot:Docs',
    type: 'question',
    subject,
    item: '1',
    files
  })
  const pauseDocs = () => {
    const docs = bots.findIndex((bot) => bot.id === 'docs')
    bots[docs] = { ...bots[docs]!, paused: true }
  }

  it('copies and claims nothing for a send refused at its quota, however often it is tried', async () => {
    alreadySent(30)
    for (const subject of ['notes', 'notes again']) {
      await expect(
        send(RANGER_THREAD, question(subject, [outside('notes.txt')]))
      ).rejects.toMatchObject({ code: 'bot_request_rate_limit' })
    }
    expect(toDocs()).toBe(30)
    expect(mailToDocs()).toBe(0)
    expect([...claims]).toEqual([])
    expect(uploadFolders()).toEqual([])
  })

  it('answers the same send again with its receipt, copying and claiming nothing more', async () => {
    const image = outside('chart.png', PNG)
    const first = await sent(RANGER_THREAD, question('the chart', [image]))
    expect(uploadFolders()).toHaveLength(1)
    expect([...claims]).toHaveLength(1)
    const again = await sent(RANGER_THREAD, question('the chart', [image]))
    expect(again).toMatchObject({ duplicate: true, message: { id: first.message.id } })
    expect(uploadFolders()).toHaveLength(1)
    expect([...claims]).toHaveLength(1)
    expect(mailToDocs()).toBe(1)
    expect(toDocs()).toBe(1)
  })

  it('gives back what it copied and claimed when its target is paused after the claim', async () => {
    onClaim = pauseDocs
    await expect(
      send(RANGER_THREAD, question('the chart', [outside('chart.png', PNG)]))
    ).rejects.toMatchObject({ code: 'bot_paused' })
    expect(mailToDocs()).toBe(0)
    await vi.waitFor(() => {
      expect(uploadFolders()).toEqual([])
      expect([...claims]).toEqual([])
    })
  })

  it("leaves a store file the sender named, and another chat's claim on it, as they are", async () => {
    const shared = await store.storeWith('shared.txt', (part) =>
      Promise.resolve(writeFileSync(part, 'shared'))
    )
    const sharedUpload = uploadFolders()[0]!
    claims.add(`${sharedUpload}:other-chat`)
    onClaim = pauseDocs
    await expect(send(RANGER_THREAD, question('shared', [shared]))).rejects.toMatchObject({
      code: 'bot_paused'
    })
    // The send has settled; a give-back with nothing it copied has nothing to wait on.
    await new Promise((settled) => setTimeout(settled, 0))
    expect(uploadFolders()).toEqual([sharedUpload])
    expect(claims.has(`${sharedUpload}:other-chat`)).toBe(true)
  })

  it('still copies, claims and sends the files of the send that takes the last place', async () => {
    alreadySent(29)
    await send(RANGER_THREAD, question('notes', [outside('notes.txt')]))
    expect(toDocs()).toBe(30)
    expect(mailToDocs()).toBe(1)
    expect([...claims].map((claim) => claim.split(':')[1])).toEqual([DOCS_CHAT])
  })

  it('answers an open request asked again at a full quota with its receipt, and refuses a new one', async () => {
    alreadySent(29)
    const shared = await store.storeWith('spec.txt', (part) =>
      Promise.resolve(writeFileSync(part, 'spec'))
    )
    const first = await sent(RANGER_THREAD, question('the spec', [shared]))
    expect(toDocs()).toBe(30)
    const again = await sent(RANGER_THREAD, question('the spec', [shared]))
    expect(again).toMatchObject({ duplicate: true, message: { id: first.message.id } })
    expect(toDocs()).toBe(30)
    expect(mailToDocs()).toBe(1)
    expect(uploadFolders()).toHaveLength(1)
    // A changed request is a new one, refused at the quota; the owner is told once for it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        send(RANGER_THREAD, question('the spec, again', [shared]))
      ).rejects.toMatchObject({ code: 'bot_request_rate_limit' })
    }
    expect(notes).toHaveLength(1)
  })
})
