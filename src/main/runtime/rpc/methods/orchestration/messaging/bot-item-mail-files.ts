// `send --to bot:<name> --item <n> --file`: files sent with mail about an item, admitted into that
// item's chat as its comments' are. Images go with the mail as the chat's image blocks; other files
// join the body as `@path`. A paired Orca's files arrive already uploaded to this store.
import { isAgentInlineImagePath } from '../../../../../../shared/native-chat/input/composer/agent-inline-image-types'
import { formatNativeChatFileReference } from '../../../../../../shared/native-chat/input/composer/agent-image-paste'
import { parseBotAddress, botOfAddress } from '../../../../../../shared/bot-roster'
import { admitBotItemCommentAttachments } from '../../../../../bots/bot-item-comment-attachments'
import { BotItemError } from '../../../../../bots/bot-item-error'
import { rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import {
  getAgentSessionAttachmentClaimer,
  getAgentSessionAttachmentClaimPruner,
  getAgentSessionAttachmentStore,
  publishAgentSessionUploadRemoval
} from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-store-registry'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { resolveItem } from '../../bots-items-write-support'
import { botChatTakingMail } from '../../bots-chats'

type ItemMail = {
  to: string
  params: { item?: string; body?: string; files?: string[] }
  attachments?: readonly string[]
  images?: readonly string[]
}

/** A bot request's files as the sender named them (part of what makes it the same send), how they
 *  are made ready for the receiving chat, and how a send never stored gives back what that copied. */
export type ItemMailFiles<Params> = {
  sources: readonly string[]
  prepare: () => Promise<{ params: Params; images?: readonly string[] }>
  giveBack: () => Promise<void>
}

/** What a send copied into the store for its mail, and the chat it claimed it for. */
export type ItemMailCopies = { paths: readonly string[]; claimedFor: string | null }

export async function withItemMailFiles<T extends ItemMail>(
  runtime: OrcaRuntimeService,
  mail: T,
  copied?: (copies: ItemMailCopies) => void
): Promise<T> {
  const local = mail.params.files ?? []
  const uploaded = mail.attachments ?? []
  if (local.length === 0 && uploaded.length === 0) {
    return mail
  }
  const name = parseBotAddress(mail.to)
  const bot = name === null ? undefined : botOfAddress(runtime.bots.list(), name)
  if (mail.params.item === undefined || !bot) {
    throw new OrchestrationError(
      'invalid_argument',
      "--file goes with --to bot:<name> --item <n>: the files go to that item's chat. Nothing was sent."
    )
  }
  const item = await resolveItem(runtime.botItems.store(), mail.params.item)
  await runtime.ensureStructuredAgentSessionHost().catch(() => undefined)
  const others = uploaded.filter((path) => !isAgentInlineImagePath(path))
  const body = [mail.params.body?.trimEnd(), others.map(formatNativeChatFileReference).join('\n')]
    .filter(Boolean)
    .join('\n\n')
  try {
    const { text, images } = await admitBotItemCommentAttachments(
      {
        store: getAgentSessionAttachmentStore(),
        local: local.length > 0,
        claim: getAgentSessionAttachmentClaimer(),
        chat: () => botChatTakingMail(runtime, bot, item.chatId),
        ...(copied ? { copied } : {})
      },
      body,
      uploaded.filter(isAgentInlineImagePath),
      local
    )
    return {
      ...mail,
      params: { ...mail.params, body: text },
      images: images.map(({ path }) => path)
    }
  } catch (error) {
    if (error instanceof BotItemError) {
      throw new OrchestrationError('invalid_argument', `${error.message} Nothing was sent.`)
    }
    throw error
  }
}

/** Gives back what a send that was never stored copied in: each fresh upload's folder, then its claim
 *  for the receiving chat. Only copies it made itself, which nothing else names, so a store file the
 *  sender named and any other chat's or message's claim are left as they are. */
export async function giveBackItemMailFiles({ paths, claimedFor }: ItemMailCopies): Promise<void> {
  const uploadDirs = [...new Set(paths.map((path) => dirname(path)))]
  await Promise.all(
    uploadDirs.map((uploadDir) => rm(uploadDir, { recursive: true, force: true }).catch(() => {}))
  )
  uploadDirs.forEach(publishAgentSessionUploadRemoval)
  const prune = getAgentSessionAttachmentClaimPruner()
  if (claimedFor && prune && uploadDirs.length > 0) {
    // A claim left behind is still dropped by the store's next sweep, its upload being gone.
    await prune(
      uploadDirs.map((uploadDir) => ({ uploadId: basename(uploadDir), sessionId: claimedFor }))
    ).catch((error: unknown) => console.warn('[bots] could not drop an unsent mail claim', error))
  }
}

/** The mail's body with its images named as `@path` too, for mail that carries no image blocks. */
export function itemMailFilesBody(mail: Pick<ItemMail, 'params' | 'images'>): string {
  const images = (mail.images ?? []).map(formatNativeChatFileReference).join('\n')
  return [mail.params.body?.trimEnd(), images].filter(Boolean).join('\n\n')
}
