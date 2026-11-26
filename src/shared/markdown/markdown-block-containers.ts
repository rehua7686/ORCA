const BLANK_LINE = /^[ \t\r]*$/

export type MarkdownContainer = number | 'quote'

const TABLE_QUOTE_PREFIX = /^ {0,3}>[ \t]?/
const TABLE_LIST_PREFIX = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t]+)/

// Only a literal ordinal 1 followed by whitespace interrupts a paragraph or active table.
export const TABLE_BODY_ORDERED_ITEM = /^ {0,3}(?!1[.)][ \t])\d{1,9}[.)](?:[ \t]|$)/

export function splitMarkdownContainerPrefix(line: string, allowLaterOrdered = true): {
  containers: MarkdownContainer[]
  rest: string
} {
  const containers: MarkdownContainer[] = []
  let rest = line
  let allowsOrdered = allowLaterOrdered
  for (;;) {
    const quote = TABLE_QUOTE_PREFIX.exec(rest)
    if (quote) {
      containers.push('quote')
      rest = rest.slice(quote[0].length)
      continue
    }
    const list = TABLE_LIST_PREFIX.exec(rest)
    if (!list || (!allowsOrdered && TABLE_BODY_ORDERED_ITEM.test(rest))) {
      return { containers, rest }
    }
    allowsOrdered = true
    const markerWidth = list[1].length
    let width = markerWidth
    for (const character of list[2]) {
      width += character === '\t' ? 4 - (width % 4) : 1
    }
    // As marked does, excess padding leaves an indented code block after one space.
    if (width - markerWidth > 4) {
      containers.push(markerWidth + 1)
      rest = ' '.repeat(width - markerWidth - 1) + rest.slice(list[0].length)
    } else {
      containers.push(width)
      rest = rest.slice(list[0].length)
    }
  }
}

export function stripMarkdownContainerPrefix(
  line: string,
  containers: MarkdownContainer[],
  allowLazy = true
): string | null {
  let rest = line
  for (const container of containers) {
    if (container === 'quote') {
      const quote = TABLE_QUOTE_PREFIX.exec(rest)
      if (!quote) {
        return null
      }
      rest = rest.slice(quote[0].length)
      continue
    }
    let width = 0
    let end = 0
    while (end < rest.length && width < container && /[ \t]/.test(rest[end])) {
      width += rest[end] === '\t' ? 4 : 1
      end += 1
    }
    // List items may contain lazy continuation lines with less indentation.
    if (width >= container) {
      rest = ' '.repeat(width - container) + rest.slice(end)
    } else if (!BLANK_LINE.test(rest) && (!allowLazy || TABLE_LIST_PREFIX.test(rest))) {
      // A sibling list marker ends the current item before lazy continuation applies.
      return null
    }
  }
  return rest
}
