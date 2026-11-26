import { getMarkdownCodeFenceRanges } from './markdown-code-span-scanner'
import type { MarkdownFenceRanges } from './markdown-fence-tracker'

export {
  createMarkdownFenceTracker,
  findMarkdownLineEnd,
  forEachMarkdownLine,
  skipMarkdownLineBreak,
  type MarkdownFenceRanges,
  type MarkdownFenceTracker
} from './markdown-fence-tracker'

/** Offsets of every fenced code block, including its delimiter lines. */
export function getMarkdownFenceRanges(content: string): MarkdownFenceRanges {
  return getMarkdownCodeFenceRanges(content)
}

export function isInsideMarkdownFenceRange(index: number, ranges: MarkdownFenceRanges): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

/** Same test for callers that probe non-decreasing offsets, in linear total time. */
export function createMarkdownFenceRangeCursor(
  ranges: MarkdownFenceRanges
): (index: number) => boolean {
  let cursor = 0
  return (index: number): boolean => {
    while (cursor < ranges.length && index >= ranges[cursor][1]) {
      cursor += 1
    }
    return cursor < ranges.length && index >= ranges[cursor][0]
  }
}
