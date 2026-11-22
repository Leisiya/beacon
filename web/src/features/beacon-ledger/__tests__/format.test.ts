/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { afterEach, expect, it, vi } from 'vitest'

import { cashRangeSchema } from '../lib/cash-range'
import {
  addMicro,
  formatCny,
  formatCredit,
  formatMicro,
  formatMicroCny,
  fromShanghaiInput,
} from '../lib/cost'
import { ledgerMoney } from '../lib/form'

afterEach(() => {
  vi.restoreAllMocks()
})

it('uses Shanghai dates at UTC month boundaries and preserves cents beyond int64', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-31T16:00:00Z'))
  expect(
    cashRangeSchema.safeParse({
      period: 'custom',
      start: '2026-02-01',
      end: '2026-02-01',
    }).success
  ).toBe(true)
  expect(
    cashRangeSchema.safeParse({
      period: 'custom',
      start: '2026-02-01',
      end: '2026-02-02',
    }).success
  ).toBe(false)
  expect(
    cashRangeSchema.safeParse({
      period: 'custom',
      start: '2025-02-29',
      end: '2025-03-01',
    }).success
  ).toBe(false)
  expect(ledgerMoney('9232379236109515775', 'CNY')).toBe(
    'CNY 92323792361095157.75'
  )
})

it('formats upstream cost millionths exactly and converts Shanghai times', () => {
  expect(formatMicro('23936', 4)).toBe('0.0239')
  expect(formatMicro('23950', 4)).toBe('0.0240')
  expect(formatMicro('-1500000', 2)).toBe('-1.50')
  expect(formatMicro('9232379236109515775', 2)).toBe('9232379236109.52')
  expect(formatMicroCny('-21860', 4)).toBe('-¥0.0219')
  expect(formatMicroCny('-40', 4)).toBe('¥0.0000')
  expect(addMicro('9232379236109515775', '-1', '2')).toBe('9232379236109515776')
  expect(fromShanghaiInput('2026-11-18T00:00')).toBe(1794931200)
})

it('groups finance amounts and keeps four decimals only under one unit', () => {
  expect(formatCny('123456789000000')).toBe('¥123,456,789.00')
  expect(formatCny('-27000000')).toBe('-¥27.00')
  expect(formatCny('3200')).toBe('¥0.0032')
  expect(formatCny('-40')).toBe('¥0.0000')
  expect(formatCny('0')).toBe('¥0.00')
  expect(formatCredit(41500000)).toBe('$41.50')
  expect(formatCredit('-500000')).toBe('-$0.5000')
})
