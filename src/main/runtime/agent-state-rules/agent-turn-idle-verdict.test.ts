import { describe, expect, it } from 'vitest'
import { AGENT_START_GRACE_MS, judgeIdleAgentTurn } from './agent-turn-idle-verdict'

const SENT_AT = 1_000_000
const PAST_GRACE = SENT_AT + AGENT_START_GRACE_MS

function judgeStatusFreePane(tail: string[]): ReturnType<typeof judgeIdleAgentTurn> {
  return judgeIdleAgentTurn(
    { rows: [], sentAt: SENT_AT, tail, readAgentCommands: () => ['claude'] },
    PAST_GRACE
  )
}

describe('an idle pane whose agent never reported status', () => {
  it('fails when zsh refused the staged launch script after a startup prompt ate its leading dot', () => {
    // Captured from a scheduled run: oh-my-zsh's update prompt read the "." of ". '<script>'".
    const refusal =
      'zsh: permission denied: /var/folders/_f/15gyhphd0zv4622zfb36s_gw0000gn/T/orca-launch-ee233a6e5ee6de6a.sh'
    expect(
      judgeStatusFreePane([
        "[oh-my-zsh] Would you like to update? [Y/n] . '/var/folders/_f/T/orca-launch-ee233a6e5ee6de6a.sh'",
        '[oh-my-zsh] You can update manually by running `omz update`',
        refusal,
        '➜  ai-tuner git:(main)'
      ])
    ).toEqual({ kind: 'failed', missingCommandLine: refusal })
  })

  it('fails when bash refused the staged launch script', () => {
    const refusal = 'bash: /tmp/orca-launch-0123456789abcdef.sh: Permission denied'
    expect(judgeStatusFreePane([refusal, 'bash-5.2$'])).toEqual({
      kind: 'failed',
      missingCommandLine: refusal
    })
  })

  it('still completes when a refusal names something other than the launch script', () => {
    expect(
      judgeStatusFreePane(['cat: /Users/me/.claude/settings.json: Permission denied', '$'])
    ).toEqual({ kind: 'completed', interrupted: false })
  })
})
