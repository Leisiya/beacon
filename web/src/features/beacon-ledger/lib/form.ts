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
import { z } from 'zod'

import type { LedgerInput, LedgerKind } from '../types'

const required = z.string().trim().min(1, 'Required')
const positiveInteger = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'Enter a positive integer.')
  .refine(
    (value) => Number.isSafeInteger(Number(value)),
    'Enter a positive integer.'
  )
const money = z
  .string()
  .regex(
    /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/,
    'Enter an amount with up to two decimal places.'
  )
  .refine(
    (value) => Number(value) > 0,
    'Enter an amount with up to two decimal places.'
  )
const rate = z
  .string()
  .regex(
    /^(0|[1-9][0-9]{0,4})(\.[0-9]{1,8})?$/,
    'Enter a positive exchange rate with up to eight decimal places.'
  )
  .refine(
    (value) => Number(value) > 0,
    'Enter a positive exchange rate with up to eight decimal places.'
  )

export const ledgerFormSchema = z
  .object({
    kind: z.enum(['receipt', 'gift', 'refund', 'reversal']),
    user_id: z.string(),
    corrects_id: z.string(),
    quota: z.string(),
    amount: z.string(),
    currency: z.enum(['CNY', 'USD', 'EUR', 'HKD']),
    cny_per_unit: z.string(),
    fx_source: z.string().max(255),
    payment_method: z.string().max(32),
    payment_reference: z.string().max(128),
    occurred_at: required.refine((value) => {
      const time = Date.parse(`${value}+08:00`)
      return (
        Number.isFinite(time) &&
        time >= 946684800000 &&
        time <= Date.now() + 300000
      )
    }, 'Enter a valid date in Shanghai time, no later than now.'),
    note: required.max(1000),
  })
  .superRefine((value, ctx) => {
    const check = (key: keyof typeof value, schema: z.ZodType): void => {
      const result = schema.safeParse(value[key])
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: result.error.issues[0].message,
        })
      }
    }
    if (value.kind === 'receipt' || value.kind === 'gift') {
      check('user_id', positiveInteger)
      check('quota', positiveInteger)
    } else check('corrects_id', positiveInteger)
    if (value.kind === 'receipt') {
      check('amount', money)
      if (value.currency === 'CNY' && Number(value.cny_per_unit) !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['cny_per_unit'],
          message: 'The CNY exchange rate must be 1.',
        })
      }
    }
    if (value.kind === 'receipt' || value.kind === 'refund') {
      check('cny_per_unit', rate)
      check('fx_source', required)
      check('payment_method', required)
      check('payment_reference', required)
    }
  })

export type LedgerFormValues = z.infer<typeof ledgerFormSchema>

export function newLedgerForm(
  kind: LedgerKind = 'receipt',
  sourceId = 0
): LedgerFormValues {
  return {
    kind,
    user_id: '',
    corrects_id: sourceId ? String(sourceId) : '',
    quota: '',
    amount: '',
    currency: 'CNY',
    cny_per_unit: '1',
    fx_source: '',
    payment_method: '',
    payment_reference: '',
    note: '',
    occurred_at: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16),
  }
}

export function ledgerInput(
  values: LedgerFormValues,
  key: string
): LedgerInput {
  const original = values.kind === 'receipt' || values.kind === 'gift'
  const cash = values.kind === 'receipt' || values.kind === 'refund'
  return {
    idempotency_key: key,
    kind: values.kind,
    user_id: original ? Number(values.user_id) : 0,
    quota: original ? Number(values.quota) : 0,
    corrects_id: original ? 0 : Number(values.corrects_id),
    amount: values.kind === 'receipt' ? values.amount : '',
    currency: values.kind === 'receipt' ? values.currency : '',
    cny_per_unit: cash ? values.cny_per_unit : '',
    fx_source: cash ? values.fx_source : '',
    payment_method: cash ? values.payment_method : '',
    payment_reference: cash ? values.payment_reference : '',
    occurred_at: Math.floor(Date.parse(`${values.occurred_at}+08:00`) / 1000),
    note: values.note,
  }
}

// Ledger money is historical integer cents, independent of the site's quota
// display settings. BigInt preserves every cent at the JSON-safe boundary.
export function ledgerMoney(cents: number, currency: string): string {
  const amount = BigInt(cents)
  const absolute = amount < 0n ? -amount : amount
  return `${currency} ${amount < 0n ? '-' : ''}${String(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`
}
