import { describe, expect, it } from 'vitest'
import { buildPageItems, clampPage, pageCount, pageRange, pageRangeLabel } from '~~/lib/pagination'

function numbers(page: number, totalPages: number, maxItems?: number): number[] {
  return buildPageItems(page, totalPages, maxItems).flatMap(item => item.type === 'page' ? [item.page] : [])
}

function ellipses(page: number, totalPages: number, maxItems?: number): number {
  return buildPageItems(page, totalPages, maxItems).filter(item => item.type === 'ellipsis').length
}

describe('pagination window', () => {
  it('derives a page count that never drops below one page', () => {
    expect(pageCount(0, 60)).toBe(1)
    expect(pageCount(60, 60)).toBe(1)
    expect(pageCount(61, 60)).toBe(2)
    expect(pageCount(3000, 100)).toBe(30)
    expect(pageCount(30, 0)).toBe(30)
  })

  it('clamps a requested page into the available range', () => {
    expect(clampPage(0, 12)).toBe(1)
    expect(clampPage(-4, 12)).toBe(1)
    expect(clampPage(7, 12)).toBe(7)
    expect(clampPage(99, 12)).toBe(12)
    expect(clampPage(Number.NaN, 12)).toBe(1)
  })

  it('renders every page while the count fits the window', () => {
    const items = buildPageItems(3, 5)
    expect(items.every(item => item.type === 'page')).toBe(true)
    expect(items.map(item => item.type === 'page' ? item.page : 0)).toEqual([1, 2, 3, 4, 5])
    expect(ellipses(3, 5)).toBe(0)
  })

  it('keeps the first pages visible near the start and the last pages near the end', () => {
    expect(numbers(1, 20)).toEqual([1, 2, 3, 4, 5, 20])
    expect(numbers(4, 20)).toEqual([1, 2, 3, 4, 5, 20])
    expect(ellipses(1, 20)).toBe(1)
    expect(numbers(20, 20)).toEqual([1, 16, 17, 18, 19, 20])
    expect(numbers(17, 20)).toEqual([1, 16, 17, 18, 19, 20])
  })

  it('keeps the current page inside a bounded window between two ellipses', () => {
    expect(buildPageItems(10, 20)).toEqual([
      { type: 'page', page: 1 },
      { type: 'ellipsis', key: 'ellipsis-start' },
      { type: 'page', page: 9 },
      { type: 'page', page: 10 },
      { type: 'page', page: 11 },
      { type: 'ellipsis', key: 'ellipsis-end' },
      { type: 'page', page: 20 },
    ])
  })

  it('stays bounded for very large page counts', () => {
    const items = buildPageItems(2500, 5000)
    expect(items).toHaveLength(7)
    expect(numbers(2500, 5000)).toContain(2500)
    expect(numbers(2500, 5000)[0]).toBe(1)
    expect(numbers(2500, 5000).at(-1)).toBe(5000)
    expect(buildPageItems(4999, 5000)).toHaveLength(7)
    expect(buildPageItems(2, 5000)).toHaveLength(7)
  })

  it('always shows the requested page inside the window budget', () => {
    for (let current = 1; current <= 200; current += 1) {
      const items = buildPageItems(current, 200)
      expect(items.length).toBeLessThanOrEqual(7)
      expect(numbers(current, 200)).toContain(current)
      const first = items[0]
      const last = items.at(-1)
      expect(first).toEqual({ type: 'page', page: 1 })
      expect(last).toEqual({ type: 'page', page: 200 })
    }
  })
})

describe('pagination range', () => {
  it('reports the visible item range of the current page', () => {
    expect(pageRange(1, 60, 121)).toEqual({ from: 1, to: 60 })
    expect(pageRange(2, 60, 121)).toEqual({ from: 61, to: 120 })
    expect(pageRange(3, 60, 121)).toEqual({ from: 121, to: 121 })
    expect(pageRangeLabel(2, 60, 121)).toBe('第 61–120 项，共 121 项')
  })

  it('clamps the range when the result count shrinks', () => {
    expect(pageRange(9, 50, 120)).toEqual({ from: 101, to: 120 })
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 })
    expect(pageRangeLabel(1, 50, 0)).toBe('第 0–0 项，共 0 项')
  })
})
