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
import { describe, expect, it } from 'vitest'

import {
  ledgerFormSchema,
  ledgerInput,
  ledgerMoney,
  newLedgerForm,
} from '../lib/form'

const receipt = () => ({
  ...newLedgerForm(),
  user_id: '42',
  quota: '500000',
  amount: '12.34',
  fx_source: 'bank receipt',
  payment_method: 'bank',
  payment_reference: 'ref-001',
  note: 'confirmed',
})
describe('ledger input validation', () => {
  it.each(['-1', '1.001', '1e3', '0'])(
    'rejects invalid original amount %s',
    (amount) => {
      expect(ledgerFormSchema.safeParse({ ...receipt(), amount }).success).toBe(
        false
      )
    }
  )
  it.each(['-1', '0', '1.5', '9007199254740992'])(
    'rejects unsafe quota %s',
    (quota) => {
      expect(ledgerFormSchema.safeParse({ ...receipt(), quota }).success).toBe(
        false
      )
    }
  )
  it('preserves decimal text and interprets the operator date in Shanghai', () => {
    const values = ledgerFormSchema.parse({
      ...receipt(),
      occurred_at: '2026-01-02T09:30',
    })
    const input = ledgerInput(values, 'test-request-0001')
    expect(input.amount).toBe('12.34')
    expect(input.occurred_at).toBe(Date.parse('2026-01-02T01:30:00Z') / 1000)
    expect(input.quota).toBe(500000)
  })
  it('removes hidden cash fields when the operator switches to a gift', () => {
    const input = ledgerInput(
      ledgerFormSchema.parse({ ...receipt(), kind: 'gift' }),
      'test-request-0001'
    )
    expect(input).toMatchObject({
      amount: '',
      currency: '',
      cny_per_unit: '',
      fx_source: '',
      payment_method: '',
      payment_reference: '',
    })
  })
  it('derives correction ownership and amounts on the server rather than copying form values', () => {
    const input = ledgerInput(
      ledgerFormSchema.parse({
        ...receipt(),
        kind: 'reversal',
        corrects_id: '8',
      }),
      'test-request-0001'
    )
    expect(input).toMatchObject({
      user_id: 0,
      quota: 0,
      amount: '',
      currency: '',
      corrects_id: 8,
      payment_reference: '',
    })
  })
  it('does not round away the last cent at the maximum supported amount', () => {
    expect(ledgerMoney(Number.MAX_SAFE_INTEGER, 'CNY')).toBe(
      'CNY 90071992547409.91'
    )
    expect(ledgerMoney(-1234, 'USD')).toBe('USD -12.34')
  })
  it('rejects a CNY receipt using a non-unit exchange rate', () => {
    expect(
      ledgerFormSchema.safeParse({ ...receipt(), cny_per_unit: '7' }).success
    ).toBe(false)
  })
})
