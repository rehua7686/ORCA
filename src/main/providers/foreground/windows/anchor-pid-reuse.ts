import { recognizeAgentProcessFromCommandLine } from '../../../../shared/agent-status/process/agent-process-recognition'
import type { WindowsProcessRow } from './process-rows'

/** Orphaned job members can hold recycled PIDs outside the descendant walk; the full-table anchor row proves reuse. */
export function isWindowsAnchorPidForeign(
  anchorRow: WindowsProcessRow | null,
  anchorProcessName: string | undefined
): boolean {
  if (anchorRow === null) {
    return false
  }
  const recognized =
    recognizeAgentProcessFromCommandLine(anchorRow.command) ??
    recognizeAgentProcessFromCommandLine(anchorRow.name)
  return recognized !== null
    ? // A recognized row is foreign when it names a DIFFERENT agent.
      anchorProcessName !== undefined && recognized.processName !== anchorProcessName
    : // Query-denied command === name is inconclusive, never foreign proof.
      anchorRow.command !== anchorRow.name
}

/** PID-reuse proof outlives an unavailable identity, so the cached agent is not restored over it. */
export function unavailableWindowsForeground(anchorPidForeign: boolean): {
  available: false
  processName: null
  anchorPidForeign?: true
} {
  return {
    available: false,
    processName: null,
    ...(anchorPidForeign ? { anchorPidForeign: true } : {})
  }
}
