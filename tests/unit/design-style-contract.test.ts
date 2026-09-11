import { describe, expect, it } from 'vitest'
import { analyzeStyles } from '../../scripts/styles/analyze.mjs'

const tokens = { file: 'assets/css/tokens.css', source: ':root { --accent: #a44825; --text-base: .875rem; --font-scale: 1; --radius-sm: .375rem; }' }
const component = (source: string, file = 'components/Example.vue') => ({ file, source })
const messages = (sources: { file: string; source: string }[]) => analyzeStyles([tokens, ...sources]).map(item => item.message).join('\n')

describe('parsed design-system contract', () => {
  it('rejects the three audit escape cases together instead of reporting a false pass', () => {
    const result = analyzeStyles([
      { ...tokens, source: ':root { --accent: var(--missing-color); }' },
      component('<template><p>Example</p></template><style>.example { background: white; font-size: var(--missing-size, 13px); }</style>'),
    ]).map(item => item.message).join('\n')
    expect(result).toContain('颜色必须使用语义变量：white')
    expect(result).toContain('未定义的样式变量：--missing-color')
    expect(result).toContain('未定义的样式变量：--missing-size')
    expect(result).toContain('font-size 必须使用设计变量：13px')
  })

  it.each(['rgb(1 2 3 / .5)', 'hsl(20 50% 40%)', 'oklch(.7 .2 30)', '#fff', 'rebeccapurple'])('rejects literal color %s inside a real CSS declaration', color => {
    expect(messages([component(`<style>.x { background: ${color}; }</style>`)])).toMatch(/颜色/)
  })

  it('reads Vue style bindings, camelCase declarations and script property assignments', () => {
    const result = messages([component(`<template><p :style="{ color: 'white', fontSize: '11px', borderRadius: '6px' }" /></template><script setup>const style = {}; style['fontWeight'] = '650';</script>`)])
    expect(result).toContain('颜色必须使用语义变量：white')
    expect(result).toContain('font-size 必须使用设计变量：11px')
    expect(result).toContain('border-radius 必须使用设计变量：6px')
    expect(result).toContain('font-weight 必须使用设计变量：650')
  })

  it('checks static and conditional style strings and utility class expressions', () => {
    const result = messages([component(`<template><p style="color: black" :style="ready ? 'border-color: red' : 'color: var(--accent)'" :class="{ 'dark:hover:bg-white': ready, 'text-[13px]': ready }" /></template>`)])
    expect(result).toContain('颜色必须使用语义变量：black')
    expect(result).toContain('颜色必须使用语义变量：red')
    expect(result).toContain('工具类必须使用语义颜色：dark:hover:bg-white')
    expect(result).toContain('font-size 必须使用设计变量：13px')
  })

  it('does not interpret comments, ordinary text or BEM modifiers as color/variable declarations', () => {
    const result = messages([component(`<template><p :class="{ 'badge--active': ready }">white is a word</p></template><script setup>// color: white\nconst message = 'font-size: 12px';</script><style>/* color: red */ .x { content: "white"; color: var(--active); }</style>`)])
    expect(result).toBe('未定义的样式变量：--active')
  })

  it('validates known-variable fallbacks instead of using var() as a blanket exception', () => {
    expect(messages([component('<style>.x { font-size: var(--text-base, 13px); color: var(--accent, red); }</style>')])).toMatch(/13px[\s\S]*red/)
  })

  it('allows semantic mixes, imported local variables, SVG assets and circular geometry', () => {
    expect(messages([
      { file: 'assets/css/components/local.css', source: '.x { --local: var(--accent); }' },
      component(`<template><p :style="{ color: 'var(--local)' }" /></template><style scoped>@import '~/assets/css/components/local.css'; .x { background: color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 50%; font-size: var(--text-base); background-image: url('data:image/svg+xml,%23fff'); }</style>`),
    ])).toBe('')
  })

  it('does not borrow a sibling component variable and reports missing stylesheet imports', () => {
    const result = messages([
      component('<style>.x { --private-color: var(--accent); }</style>', 'components/Owner.vue'),
      component('<style>@import "./missing.css"; .x { color: var(--private-color); }</style>'),
    ])
    expect(result).toContain('未定义的样式变量：--private-color')
    expect(result).toContain('样式依赖不存在')
  })

  it('catches cycles inside theme definitions and preserves valid independent theme overrides', () => {
    expect(analyzeStyles([{ ...tokens, source: ':root { --a: var(--b); --b: var(--a); }' }]).some(item => item.message.includes('循环依赖'))).toBe(true)
    expect(analyzeStyles([{ ...tokens, source: ':root { --a: var(--b); --b: red; } .dark { --a: blue; --b: var(--a); }' }])).toEqual([])
  })

  it('reports malformed styles with file and line locations', () => {
    const result = analyzeStyles([tokens, component('<template><p /></template>\n<style>\n.x { color: var(--accent);\n</style>')])
    expect(result.some(item => item.file === 'components/Example.vue' && item.line >= 2 && item.message.includes('解析失败'))).toBe(true)
  })

  it('keeps the explicit root zoom exception without allowing arbitrary component typography', () => {
    expect(messages([{ file: 'assets/css/main.css', source: 'html { font-size: calc(16px * var(--font-scale, 1)); }' }])).toBe('')
    expect(messages([component('<style>.x { font-size: calc(16px * var(--font-scale, 1)); }</style>')])).toContain('font-size 必须使用设计变量')
  })
})

describe('style structure and ownership', () => {
  it('rejects repeated page selectors while allowing a distinct responsive state', () => {
    const same = { file: 'assets/css/pages/config.css', source: '.config-workspace { display: grid; } .config-workspace { gap: 0; }' }
    expect(messages([same])).toContain('重复选择器')
    expect(messages([{ ...same, source: '.config-workspace, .other { display: grid; } .config-workspace { gap: 0; }' }])).toContain('重复选择器')
    expect(messages([{ ...same, source: '.config-workspace { display: grid; } @media (max-width: 767px) { .config-workspace { display: block; } }' }])).toBe('')
  })
})
