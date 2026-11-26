import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import { AutomationRunCompletionWatcher } from './run-completion-watcher'

const RUN: AutomationRun = {
  id: 'run-1',
  automationId: 'automation-1',
  title: 'run 1',
  scheduledFor: 0,
  status: 'dispatched',
  trigger: 'scheduled',
  workspaceId: null,
  sessionKind: 'terminal',
  chatSessionId: null,
  terminalSessionId: null,
  terminalPaneKey: 'tab:leaf',
  terminalPtyId: null,
  outputSnapshot: null,
  precheckResult: null,
  usage: null,
  error: null,
  startedAt: 0,
  dispatchedAt: 0,
  createdAt: 0
}

/** The error stored for a watched run whose observation rejects with `failure`. */
async function storedErrorFor(failure: Error): Promise<string | null | undefined> {
  return await new Promise((resolve) => {
    new AutomationRunCompletionWatcher({
      observer: {
        resolveRunTerminal: () => 'handle',
        observeCompletion: () => Promise.reject(failure)
      },
      readRun: () => RUN,
      markDispatchResult: (result) => {
        resolve(result.error)
        return Promise.resolve()
      }
    }).watch(RUN)
  })
}

describe('the stored error of a run Orca stopped watching', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a runtime failure code', async () => {
    expect(await storedErrorFor(new Error('terminal_not_found'))).toBe(
      'Orca stopped watching this run before it reported completion (terminal_not_found).'
    )
  })

  it('drops a message that may carry transport data', async () => {
    const generic = 'Orca stopped watching this run before it reported completion.'
    expect(
      await storedErrorFor(new Error('connect ECONNREFUSED 127.0.0.1:6768 token=abc123'))
    ).toBe(generic)
    expect(await storedErrorFor(new Error('c0ffee1234567890c0ffee1234567890'))).toBe(generic)
  })
})
