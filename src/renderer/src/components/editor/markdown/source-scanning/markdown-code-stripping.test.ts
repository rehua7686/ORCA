import { expect, it } from 'vitest'
import { getMarkdownFenceRanges } from '../../../../../../shared/markdown/markdown-fence-scanner'
import { stripMarkdownCode } from './markdown-code-stripping'

it.each([
  ['', ''],
  ['> ', '> '],
  ['> > ', '> > '],
  ['- ', '  '],
  ['123. ', '     '],
  ['- - ', '    '],
  ['> - ', '>   '],
  ['- > ', '  > ']
])('strips fenced code in %j while preserving following prose', (prefix, continuation) => {
  const source = `${prefix}\`\`\`\n${continuation}hidden\n${continuation}\`\`\`\nafter`
  expect(stripMarkdownCode(source)).toBe('\n\n\nafter')
})

it.each([
  ['> ', '> '],
  ['- ', '  '],
  ['123. ', '     '],
  ['> - ', '>   ']
])('ends an unclosed %j fence at its container boundary', (prefix, continuation) => {
  const source = `${prefix}\`\`\`\n${continuation}hidden\nafter`
  expect(stripMarkdownCode(source)).toBe('\n\nafter')
  expect(stripMarkdownCode(`${prefix}\`\`\`\n${continuation}hidden`)).toBe('\n')
})

it('preserves CRLF and keeps ordinary indented text outside fence ranges', () => {
  expect(stripMarkdownCode('> ```\r\n> hidden\r\n> ```\r\nafter')).toBe('\r\n\r\n\r\nafter')

  const indented = '    ~~~\n    ordinary text\n    ~~~\nafter'
  expect(getMarkdownFenceRanges(indented)).toEqual([])
  expect(stripMarkdownCode(indented)).toBe(indented)
})

it('keeps blank list lines inside a fence but requires every quote prefix', () => {
  expect(stripMarkdownCode('> ```\n> hidden\n\n> visible')).toBe('\n\n\n> visible')
  expect(stripMarkdownCode('- > ```\n  > hidden\n\n  > visible')).toBe('\n\n\n  > visible')

  expect(stripMarkdownCode('- ```\n  hidden\n\n  visible\n  ```\nafter')).toBe('\n\n\n\n\nafter')
  expect(stripMarkdownCode('> - ```\n>   hidden\n>\n>   visible\n>   ```\nafter')).toBe(
    '\n\n\n\n\nafter'
  )
})

it.each([
  'intro\n2. ~~~\n   keep',
  '> intro\n> 2. ~~~\n>    keep',
  '- > intro\n  > 2. ~~~\n  >    keep'
])('preserves later ordered markers that continue a paragraph: %j', (source) => {
  expect(getMarkdownFenceRanges(source)).toEqual([])
  expect(stripMarkdownCode(source)).toBe(source)
})

it.each([
  ['intro\n> 2. ~~~\n>    hidden', 'intro\n\n'],
  ['1. intro\n2. ~~~\n   hidden', '1. intro\n\n'],
  ['- intro\n  2. ~~~\n     hidden', '- intro\n\n'],
  ['intro\n\n2. ~~~\n   hidden', 'intro\n\n\n'],
  ['# intro\n2. ~~~\n   hidden', '# intro\n\n']
])('keeps independently started ordered-list fences valid: %j', (source, expected) => {
  expect(stripMarkdownCode(source)).toBe(expected)
})
