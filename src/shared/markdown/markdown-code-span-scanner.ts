import {
  createMarkdownBacktickRunLookup,
  type MarkdownCodeSpanScanner
} from './markdown-code-span-runs'

import {
  createMarkdownFenceTracker,
  findMarkdownLineEnd,
  forEachMarkdownLine,
  type MarkdownFenceRanges
} from './markdown-fence-tracker'
import {
  splitMarkdownContainerPrefix,
  stripMarkdownContainerPrefix,
  type MarkdownContainer
} from './markdown-block-containers'

const BLANK_LINE = /^[ \t\r]*$/
const BLOCKQUOTE_PREFIX = /^(?: {0,3}>[ \t]?)+/

// Match marked’s block tags: div interrupts a paragraph, while br stays inline.
const HTML_BLOCK_TAG =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul'

// These single-line blocks force the next line into a new block.
const SINGLE_LINE_BLOCK =
  /^ {0,3}(?:#{1,6}(?:\s|$)|(?:-[\t ]*){3,}$|(?:_[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:=+|-+)[ \t]*$)/

// Match marked’s paragraph interruptions so backticks cannot pair across leaf blocks.
const LEAF_BLOCK_START = new RegExp(
  [
    '^ {0,3}(?:',
    // Later ordinals open list items even though only 1 interrupts paragraphs; extra splitting only costs a check.
    '(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|$)',
    `|</?(?:${HTML_BLOCK_TAG})(?: +|/?>|$)`,
    '|<(?:script|pre|style|textarea|!--)', // a declaration or PI does not interrupt
    ')'
  ].join(''),
  'i'
)

// Only a literal ordinal 1 followed by whitespace interrupts an active table.
const TABLE_BODY_ORDERED_ITEM = /^ {0,3}(?!1[.)][ \t])\d{1,9}[.)](?:[ \t]|$)/

// marked recognizes a GFM delimiter row before validating cell counts and ends the preceding paragraph.
const TABLE_DELIMITER_ROW = /^(?=[^\n]*[:|]) {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/

function splitBlockquotePrefix(line: string): { depth: number; rest: string } {
  const prefix = BLOCKQUOTE_PREFIX.exec(line)?.[0]
  if (!prefix) {
    return { depth: 0, rest: line }
  }
  let depth = 0
  for (const character of prefix) {
    if (character === '>') {
      depth += 1
    }
  }
  return { depth, rest: line.slice(prefix.length) }
}

function findTableDelimiterAhead(
  content: string,
  start: number,
  containers: MarkdownContainer[]
): string | null {
  if (start >= content.length) {
    return null
  }
  const next = content.slice(start, findMarkdownLineEnd(content, start))
  const rest = stripMarkdownContainerPrefix(next, containers)
  return rest !== null && TABLE_DELIMITER_ROW.test(rest) ? rest : null
}

function isEscapedAt(content: string, index: number, lineStart: number): boolean {
  let cursor = index
  while (cursor > lineStart && content[cursor - 1] === '\\') {
    cursor -= 1
  }
  return (index - cursor) % 2 === 1
}

function countTableCells(line: string): number {
  const trimmed = line.trim()
  let count = 1
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '|' && !isEscapedAt(trimmed, index, 0)) {
      count += 1
    }
  }
  if (trimmed.startsWith('|')) {
    count -= 1
  }
  if (trimmed.endsWith('|') && !isEscapedAt(trimmed, trimmed.length - 1, 0)) {
    count -= 1
  }
  return count
}

type MarkdownCodeScan = { spans: MarkdownCodeSpanScanner; fences: MarkdownFenceRanges }

/** Collect spans and fences together so consumers share the same container boundaries. */
export function scanMarkdownCode(content: string): MarkdownCodeScan {
  return scanMarkdownCodeLines(content, true)
}

/** Index backtick runs once so each lookup binary-searches instead of rescanning the remaining document. */
export function createMarkdownCodeSpanScanner(content: string): MarkdownCodeSpanScanner {
  return scanMarkdownCode(content).spans
}

export function getMarkdownCodeFenceRanges(content: string): MarkdownFenceRanges {
  return scanMarkdownCodeLines(content, false).fences
}

function scanMarkdownCodeLines(content: string, includeSpans: boolean): MarkdownCodeScan {
  const starts: number[] = []
  const lengths: number[] = []
  // marked pairs backticks only within one leaf block, excluding blank lines, fences and new blocks.
  const blocks: number[] = []
  const escaped: boolean[] = []
  const runsByLength = new Map<number, number[]>()
  const fenceRanges: [number, number][] = []
  let openFenceStart = -1

  let fence = createMarkdownFenceTracker()
  let blockId = 0
  let previousWasBoundary = true
  let previousQuoteDepth = 0
  let insideTable = false
  let insideTableCells = false
  let tableContainers: MarkdownContainer[] | null = null
  let listContainers: MarkdownContainer[] = []
  let fenceContainers: MarkdownContainer[] = []
  let previousListBoundary = true

  forEachMarkdownLine(content, (lineStart, lineEnd, nextLineStart) => {
    const line = content.slice(lineStart, lineEnd)
    let wasInsideFence = fence.insideFence
    const continuedFence = wasInsideFence
      ? stripMarkdownContainerPrefix(line, fenceContainers, false)
      : null
    if (wasInsideFence && continuedFence === null) {
      fenceRanges.push([openFenceStart, lineStart])
      openFenceStart = -1
      fence = createMarkdownFenceTracker()
      wasInsideFence = false
      listContainers = []
    }
    const activeRow =
      insideTableCells && tableContainers !== null
        ? stripMarkdownContainerPrefix(line, tableContainers)
        : null
    const keepsOrderedRow = activeRow !== null && TABLE_BODY_ORDERED_ITEM.test(activeRow)
    let header = splitMarkdownContainerPrefix(line)
    if (keepsOrderedRow && activeRow !== null && tableContainers !== null) {
      header = { containers: tableContainers, rest: activeRow }
    }
    if (!wasInsideFence && !keepsOrderedRow && !BLANK_LINE.test(header.rest)) {
      let continued =
        listContainers.length > 0 ? stripMarkdownContainerPrefix(line, listContainers, false) : null
      if (
        continued === null &&
        !previousListBoundary &&
        header.containers.length === 0 &&
        !SINGLE_LINE_BLOCK.test(header.rest) &&
        !LEAF_BLOCK_START.test(header.rest) &&
        !/^ {0,3}(?:`{3,}|~{3,})/.test(header.rest)
      ) {
        continued = stripMarkdownContainerPrefix(line, listContainers)
      }
      if (continued !== null) {
        const nested = splitMarkdownContainerPrefix(continued)
        header = { containers: [...listContainers, ...nested.containers], rest: nested.rest }
      } else {
        listContainers = []
      }
      if (header.containers.some((container) => typeof container === 'number')) {
        listContainers = header.containers
      }
    }
    const isFenceBoundary =
      fence.consume(wasInsideFence ? (continuedFence ?? '') : header.rest) || wasInsideFence
    if (!wasInsideFence && fence.insideFence) {
      fenceContainers = header.containers
      openFenceStart = lineStart
    } else if (wasInsideFence && !fence.insideFence) {
      fenceRanges.push([openFenceStart, nextLineStart])
      openFenceStart = -1
    }
    const lineQuote = isFenceBoundary ? null : splitBlockquotePrefix(line)
    const isBoundary = isFenceBoundary || BLANK_LINE.test(header.rest)
    previousListBoundary =
      isBoundary || SINGLE_LINE_BLOCK.test(header.rest) || /^(?: {4}| {0,3}\t)/.test(header.rest)
    if (isBoundary) {
      insideTable = false
    }
    const quote = isBoundary ? null : lineQuote
    const quoteDepth = quote ? quote.depth : previousQuoteDepth
    const tableRest =
      tableContainers === null
        ? (quote?.rest ?? null)
        : stripMarkdownContainerPrefix(line, tableContainers)
    const isDelimiterRow = tableRest !== null && TABLE_DELIMITER_ROW.test(tableRest)
    const delimiter = !isBoundary
      ? findTableDelimiterAhead(content, nextLineStart, header.containers)
      : null
    const isTableHeader = delimiter !== null
    const blocksTableHeader =
      SINGLE_LINE_BLOCK.test(header.rest) ||
      LEAF_BLOCK_START.test(header.rest) ||
      /^(?: {4}| {0,3}\t)/.test(header.rest)
    const interruptsTable =
      tableRest !== null &&
      (SINGLE_LINE_BLOCK.test(tableRest) ||
        LEAF_BLOCK_START.test(tableRest) ||
        /^(?: {4}| {0,3}[\t>])/.test(tableRest)) &&
      !TABLE_BODY_ORDERED_ITEM.test(tableRest)
    if (isBoundary || tableRest === null || interruptsTable) {
      insideTableCells = false
      tableContainers = null
    }
    // A delimiter can interrupt a paragraph even when mismatched columns prevent a table.
    if (
      !isBoundary &&
      header.rest.trim().length > 0 &&
      delimiter !== null &&
      !blocksTableHeader &&
      countTableCells(header.rest) === countTableCells(delimiter)
    ) {
      insideTableCells = true
      tableContainers = header.containers
    }
    insideTable = insideTable || isDelimiterRow
    // marked parses every cell on its own; rows end the current inline context too.
    const endsWithLine =
      quote !== null && (SINGLE_LINE_BLOCK.test(quote.rest) || isTableHeader || insideTable)
    // A deeper quote opens a block; a shallower one can be a lazy continuation.
    const startsLeafBlock =
      quote !== null &&
      (endsWithLine || quote.depth > previousQuoteDepth || LEAF_BLOCK_START.test(quote.rest))
    if (isBoundary || previousWasBoundary || startsLeafBlock) {
      blockId += 1
    }
    previousWasBoundary = isBoundary || endsWithLine
    previousQuoteDepth = quoteDepth
    if (isBoundary || !includeSpans) {
      return
    }

    let index = lineStart
    while (index < lineEnd) {
      if (insideTableCells && content[index] === '|' && !isEscapedAt(content, index, lineStart)) {
        blockId += 1
      }
      if (content[index] !== '`') {
        index += 1
        continue
      }
      const runStart = index
      while (index < lineEnd && content[index] === '`') {
        index += 1
      }
      const runLength = index - runStart
      const runsOfLength = runsByLength.get(runLength)
      if (runsOfLength) {
        runsOfLength.push(starts.length)
      } else {
        runsByLength.set(runLength, [starts.length])
      }
      starts.push(runStart)
      lengths.push(runLength)
      blocks.push(blockId)
      escaped.push(isEscapedAt(content, runStart, lineStart))
    }
  })

  if (openFenceStart !== -1) {
    fenceRanges.push([openFenceStart, content.length])
  }
  return {
    spans: createMarkdownBacktickRunLookup(starts, lengths, runsByLength, blocks, escaped),
    fences: fenceRanges
  }
}

export function skipMarkdownBacktickRun(content: string, index: number): number {
  let end = index
  while (content[end] === '`') {
    end += 1
  }
  return end
}
