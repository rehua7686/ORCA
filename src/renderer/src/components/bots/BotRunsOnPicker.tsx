// Where a new bot runs: Computer and Agent side by side in New bot, or a quiet "<host> · <agent>" link in
// Import from another app that opens them in a popover.
import React, { useEffect, useId, useRef } from 'react'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { type BotAgent, botFolderName, newBotName } from '../../../../shared/bot-types'
import { useHostBots } from '@/lib/bot-catalog'
import type { NewTabAgentMenuModel } from '../agent/launch-menu/new-tab-agent-menu-model'
import { COMBOBOX_FIELD_SHELL } from '../new-workspace/type-ahead/type-ahead-combobox-styles'
import { BotAgentLaunchPicker, type BotAgentSetup } from './BotAgentLaunchPicker'
import {
  botCreateHostBlockedHint,
  useServerUpdatable,
  type BotCreateHostBlock,
  type BotCreateHostChoice
} from './bot-create-hosts'
import { BotComputerPicker } from './BotComputerPicker'
import { botAgentLabel, botFolderDisplay } from './bot-presentation'
import type { BotPermissionIntent } from './use-bot-agent-setup'
import { useWslHostDistro } from '@/components/wsl-host-mark/WslHostMark'
import { BotWslSetupCard } from './BotWslSetupCard'
import { BotWslNoAgentHint } from './BotWslNoAgentHint'

function computerErrorLabel(blocked: BotCreateHostBlock, updatable: boolean, t: Translate): string {
  switch (blocked) {
    case 'offline':
      return t('bots.new.validation.computerOffline', 'Offline')
    case 'no-bots':
      return updatable
        ? t('bots.new.validation.updateOrca', 'Update Orca')
        : t('bots.new.validation.botsUnavailable', 'Bots unavailable')
    case 'needs-server':
      return t('bots.new.hostNeedsServer', 'Needs Orca server')
  }
}

/** Where a new bot's home goes, named as the runtime names it among `bots` on that computer. */
export function botFolderPreview(
  name: string,
  bots: readonly { name: string }[],
  windows?: boolean
): string {
  return botFolderDisplay(botFolderName(newBotName(name, bots)), windows)
}

function BotFolderPreview({ name, host }: { name: string; host: BotCreateHostChoice['host'] }) {
  const t = useTranslate()
  const bots = useHostBots(host.hostId)
  return (
    <p className="text-2xs text-muted-foreground">
      {t('bots.new.folder', 'Folder: {{path}}', {
        path: botFolderPreview(name, bots, host.windows)
      })}
    </p>
  )
}

/** Whether New bot's Agent field shows a placeholder (no agents, or a WSL distro being set up or
 *  waking) instead of the picker, so nothing offers to change a setup the owner cannot see. */
export function useBotAgentFieldPlaceholder(
  { host, wslSetup }: BotCreateHostChoice,
  model: NewTabAgentMenuModel,
  choices: readonly BotAgent[]
): boolean {
  const wslDistro = useWslHostDistro(host.hostId)
  const noAgents = model.state === 'settled' && choices.length === 0
  const hostWaking = Boolean(host.sleeping || host.waking)
  return wslSetup.state.phase !== 'idle' || noAgents || (hostWaking && Boolean(wslDistro))
}

export function BotRunsOnPicker({
  hostChoice,
  setup,
  model,
  choices,
  onSetupChange,
  keptPermission,
  onAddHost,
  name,
  showSubmitFeedback = false,
  variant = 'link',
  agentFieldRef
}: {
  /** The computer it runs on (`useBotCreateHost`). */
  hostChoice: BotCreateHostChoice
  /** The agent, already the first one that computer has, with its model and permissions. */
  setup: BotAgentSetup
  /** The chosen computer's agent menu (`useBotAgentMenu`). */
  model: NewTabAgentMenuModel
  /** The agents that computer has. */
  choices: readonly BotAgent[]
  onSetupChange: (setup: BotAgentSetup, permissionPicked?: boolean) => void
  /** A bot from a link: the owner's permission, kept apart from the agent (`useBotAgentSetup`). */
  keptPermission?: BotPermissionIntent
  onAddHost?: (mode: 'ssh' | 'server') => void
  /** The bot's name, for its folder. */
  name?: string
  showSubmitFeedback?: boolean
  /** `link` is a quiet "<host> · <agent>" link that opens the fields; `fields` shows them side by side,
   *  and leaves Use chat defaults to the dialog's footer. */
  variant?: 'link' | 'fields'
  /** The Agent field, for focus to land on (`fields` only). */
  agentFieldRef?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const t = useTranslate()
  const computerErrorId = useId()
  const agentErrorId = useId()
  const { host, otherAccount } = hostChoice
  const updatable = useServerUpdatable()
  const canUpdate = Boolean(host.environmentId && updatable(host.environmentId))
  const computerError =
    showSubmitFeedback && host.blocked ? computerErrorLabel(host.blocked, canUpdate, t) : null
  const chosen = setup.agent
  const fields = variant === 'fields'
  const computerHint =
    computerError ??
    botCreateHostBlockedHint(host, canUpdate, t) ??
    (otherAccount
      ? t('bots.new.computerAccountHint', 'Where the bot runs, signed in to Orca as {{account}}.', {
          account: otherAccount
        })
      : fields
        ? null
        : t('bots.new.computerHint', 'Where the bot runs.'))
  const noAgents = model.state === 'settled' && choices.length === 0
  const computerRef = useRef<HTMLDivElement>(null)
  const wslSetup = hostChoice.wslSetup
  const setupState = wslSetup.state
  const settingUp = setupState.phase !== 'idle'
  const wslDistro = useWslHostDistro(host.hostId)
  const placeholder = useBotAgentFieldPlaceholder(hostChoice, model, choices)
  const addedHostReady =
    setupState.phase === 'finding-agents' &&
    host.environmentId === setupState.environmentId &&
    model.state === 'settled'
  const { finish } = wslSetup
  useEffect(() => {
    if (addedHostReady) {
      finish()
    }
  }, [addedHostReady, finish])
  // A sleeping, waking or unreachable host's agents are unknown, not missing.
  const hostWaking = Boolean(host.sleeping || host.waking)
  const wslNoAgent =
    fields && noAgents && !settingUp && !hostWaking && !host.blocked && wslDistro !== null
  const agentInvalid = showSubmitFeedback && !host.blocked && noAgents && !settingUp
  const findingAgents = showSubmitFeedback && !host.blocked && model.state === 'loading'
  const agentLabel = t('bots.new.agent', 'Agent')
  const labelVariant = fields ? 'settings' : undefined
  const controls = (
    <>
      <div className="min-w-0 space-y-1">
        <Label variant={labelVariant}>{t('bots.new.computer', 'Computer')}</Label>
        <div ref={computerRef}>
          <BotComputerPicker
            hostChoice={hostChoice}
            onAddHost={onAddHost}
            errorId={computerError ? computerErrorId : undefined}
          />
        </div>
        {computerHint ? (
          <p
            id={computerError ? computerErrorId : undefined}
            role={computerError ? 'alert' : undefined}
            className={cn('text-2xs', computerError ? 'text-destructive' : 'text-muted-foreground')}
          >
            {computerHint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-1">
        <Label variant={labelVariant}>{agentLabel}</Label>
        <div
          ref={fields ? agentFieldRef : undefined}
          role={fields ? 'group' : undefined}
          tabIndex={fields ? -1 : undefined}
          aria-label={fields ? agentLabel : undefined}
          aria-invalid={agentInvalid || undefined}
          aria-describedby={agentInvalid ? agentErrorId : undefined}
          className={
            fields
              ? 'group/agent rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:aria-invalid:ring-destructive/20 dark:focus-visible:aria-invalid:ring-destructive/40'
              : undefined
          }
        >
          {fields && placeholder ? (
            <div
              className={cn(
                COMBOBOX_FIELD_SHELL,
                'text-sm text-muted-foreground group-aria-invalid/agent:border-destructive'
              )}
            >
              <span className="truncate">
                {settingUp
                  ? t('bots.new.wslSetup.waiting', 'Waiting for {{distro}}…', {
                      distro: setupState.distro.name
                    })
                  : hostWaking && wslDistro
                    ? t('bots.new.wslWaking', 'Waking {{distro}}…', { distro: wslDistro })
                    : wslDistro
                      ? t('bots.new.wslNoAgent.field', 'No agent in {{distro}}', {
                          distro: wslDistro
                        })
                      : t('bots.new.validation.noAgents', 'No agents')}
              </span>
            </div>
          ) : noAgents ? (
            <p className="text-2xs text-muted-foreground">
              {t('bots.new.noChatAgents', 'No chat agents available on this computer.')}
            </p>
          ) : (
            <BotAgentLaunchPicker
              key={host.hostId}
              model={model}
              choices={choices.length ? choices : [chosen]}
              value={setup}
              onChange={onSetupChange}
              keptPermission={keptPermission}
              showChatDefaultHint={!fields}
              showReset={!fields}
            />
          )}
        </div>
        {agentInvalid ? (
          <p id={agentErrorId} role="alert" className="text-2xs text-destructive">
            {t('bots.new.validation.noAgentsAvailable', 'No agents available')}
          </p>
        ) : null}
        {findingAgents ? (
          <p role="status" className="text-2xs text-muted-foreground">
            {t('bots.new.validation.findingAgents', 'Finding agents…')}
          </p>
        ) : null}
      </div>
      {name !== undefined ? <BotFolderPreview name={name} host={host} /> : null}
    </>
  )
  if (fields) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">{controls}</div>
        <BotWslSetupCard
          state={setupState}
          onCancel={wslSetup.cancel}
          onRetry={wslSetup.retry}
          onChooseAnother={() => {
            wslSetup.cancel()
            // Opens the Computer list, as a click on the field does.
            computerRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.click()
          }}
        />
        {wslNoAgent && wslDistro && host.environmentId ? (
          <BotWslNoAgentHint distro={wslDistro} environmentId={host.environmentId} />
        ) : null}
      </div>
    )
  }
  // Full label on hover, since a long host truncates it.
  const runsOnLabel = t('bots.new.runsOnLink', '{{host}} · {{agent}}', {
    host: host.label,
    agent: noAgents ? agentLabel : botAgentLabel(chosen)
  })
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={runsOnLabel}
          className="min-w-0 truncate rounded-sm text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:text-foreground"
        >
          {runsOnLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        // Focus the card, not the Computer field, whose list would open on focus.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus()
          }
        }}
        className="w-[min(20rem,var(--radix-popover-content-available-width))]"
      >
        <div className="space-y-3 p-3">{controls}</div>
      </PopoverContent>
    </Popover>
  )
}
