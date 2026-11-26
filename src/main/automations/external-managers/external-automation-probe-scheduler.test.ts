import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ExternalAutomationProbeCancelledError,
  ExternalAutomationProbeScheduler
} from './external-automation-probe-scheduler'

it('reads again after scope cancellation while the abandoned provider is still settling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orca-external-probe-'))
  const file = join(directory, 'provider-state')
  const scheduler = new ExternalAutomationProbeScheduler({ concurrency: 2 })
  const observed = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  try {
    await writeFile(file, 'before')
    const abandoned = scheduler.schedule({
      key: 'local|openclaw',
      scopeKey: 'local',
      run: async () => {
        const value = await readFile(file, 'utf8')
        observed.resolve()
        await release.promise
        return value
      }
    })
    await observed.promise
    scheduler.retainScopes([])
    await expect(abandoned).rejects.toBeInstanceOf(ExternalAutomationProbeCancelledError)
    await writeFile(file, 'after')
    const current = scheduler.schedule({
      key: 'local|openclaw',
      scopeKey: 'local',
      run: () => readFile(file, 'utf8')
    })
    await expect(current).resolves.toBe('after')
  } finally {
    release.resolve()
    scheduler.cancelAll()
    await rm(directory, { recursive: true, force: true })
  }
})
