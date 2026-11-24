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

import { getCurrencyDisplay } from '@/lib/currency'
import { parseQuotaFromDollars } from '@/lib/format'

import type {
  BookSource,
  EntryKind,
  ExpenseCategory,
  ExpenseInput,
  LedgerInput,
  UpstreamPaymentInput,
} from '../types'

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

const upstreamCredit = z
  .string()
  .regex(
    /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/,
    'Enter credit above 0 with up to six decimal places.'
  )
  .refine(
    (value) => Number(value) > 0,
    'Enter credit above 0 with up to six decimal places.'
  )

export const expenseCategories: ExpenseCategory[] = [
  'server',
  'promotion',
  'other',
]

// i18n keys of each kind of entry.
export const entryKindLabels: Record<EntryKind, string> = {
  receipt: 'Manual receipt',
  gift: 'Gift quota',
  refund: 'Full refund',
  reversal: 'Reverse entry',
  upstream: 'Upstream top-up',
  server: 'Server cost',
  promotion: 'Promotion cost',
  other: 'Other cost',
}

export function entrySource(kind: EntryKind): BookSource {
  if (kind === 'upstream') return 'upstream'
  return expenseCategories.includes(kind as ExpenseCategory)
    ? 'expense'
    : 'customer'
}

export const ledgerFormSchema = z
  .object({
    kind: z.enum([
      'receipt',
      'gift',
      'refund',
      'reversal',
      'upstream',
      'server',
      'promotion',
      'other',
    ]),
    user_id: z.string(),
    corrects_id: z.string(),
    credit: z.string(),
    amount: z.string(),
    currency: z.enum(['CNY', 'USD', 'EUR', 'HKD']),
    cny_per_unit: z.string(),
    channel_id: z.string(),
    upstream_credit: z.string(),
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
    note: z.string().max(500),
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
      check('credit', money)
      const quota = parseQuotaFromDollars(Number(value.credit))
      if (
        money.safeParse(value.credit).success &&
        (quota < 1 || !Number.isSafeInteger(quota))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['credit'],
          message: 'Enter a balance of at least one quota unit.',
        })
      }
    } else if (value.kind === 'refund' || value.kind === 'reversal') {
      check('corrects_id', positiveInteger)
    }
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
      check('payment_method', required)
      check('payment_reference', required)
    }
    if (value.kind === 'upstream') {
      check(
        'channel_id',
        z.string().regex(/^[1-9][0-9]*$/, 'Choose an upstream.')
      )
      check('amount', money)
      check('upstream_credit', upstreamCredit)
    }
    if (entrySource(value.kind) === 'expense') check('amount', money)
  })

export type LedgerFormValues = z.infer<typeof ledgerFormSchema>

export function newLedgerForm(
  kind: EntryKind = 'receipt',
  sourceId = 0
): LedgerFormValues {
  return {
    kind,
    user_id: '',
    corrects_id: sourceId ? String(sourceId) : '',
    credit: '',
    amount: '',
    currency: 'CNY',
    cny_per_unit: '1',
    channel_id: '',
    upstream_credit: '',
    payment_method: '',
    payment_reference: '',
    note: '',
    occurred_at: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16),
  }
}

// A reviewed entry, ready to post to the endpoint of its source. Fields the
// chosen kind does not show are left out.
export type EntryRequest =
  | { source: 'customer'; input: LedgerInput }
  | { source: 'upstream'; input: UpstreamPaymentInput }
  | { source: 'expense'; input: ExpenseInput }

export function entryRequest(
  values: LedgerFormValues,
  key: string
): EntryRequest {
  const occurredAt = Math.floor(
    Date.parse(`${values.occurred_at}+08:00`) / 1000
  )
  if (values.kind === 'upstream') {
    return {
      source: 'upstream',
      input: {
        request_key: key,
        channel_id: Number(values.channel_id),
        amount: values.amount,
        credit: values.upstream_credit,
        corrects_id: 0,
        occurred_at: occurredAt,
        note: values.note.trim(),
      },
    }
  }
  if (entrySource(values.kind) === 'expense') {
    return {
      source: 'expense',
      input: {
        request_key: key,
        category: values.kind as ExpenseCategory,
        amount: values.amount,
        corrects_id: 0,
        occurred_at: occurredAt,
        note: values.note.trim(),
      },
    }
  }
  return { source: 'customer', input: ledgerInput(values, key) }
}

export function ledgerInput(
  values: LedgerFormValues,
  key: string
): LedgerInput {
  const kind = values.kind as LedgerInput['kind']
  const original = kind === 'receipt' || kind === 'gift'
  const cash = kind === 'receipt' || kind === 'refund'
  return {
    idempotency_key: key,
    kind,
    user_id: original ? Number(values.user_id) : 0,
    quota: original ? parseQuotaFromDollars(Number(values.credit)) : 0,
    corrects_id: original ? 0 : Number(values.corrects_id),
    amount: kind === 'receipt' ? values.amount : '',
    currency: kind === 'receipt' ? values.currency : '',
    cny_per_unit: cash ? values.cny_per_unit : '',
    fx_source: '',
    payment_method: cash ? values.payment_method : '',
    payment_reference: cash ? values.payment_reference : '',
    occurred_at: Math.floor(Date.parse(`${values.occurred_at}+08:00`) / 1000),
    note: '',
  }
}

// The top-up price setting sells one system USD of balance for `price` CNY,
// the same rate the pricing page uses, so this is what a receipt buys at list
// price. Null until the amount and rate describe a payment.
export function receiptFaceQuota(
  amount: string,
  cnyPerUnit: string,
  price: number
): number | null {
  const cny = Number(amount) * Number(cnyPerUnit)
  if (!(cny > 0) || !(price > 0)) return null
  return Math.round((cny / price) * getCurrencyDisplay().config.quotaPerUnit)
}

// Ledger money is historical integer cents, independent of the site's quota
// display settings. BigInt preserves every cent at the JSON-safe boundary.
// Request keys make a resubmitted ledger or payment post safe to repeat.
// crypto.randomUUID exists only on HTTPS or localhost; the site may be served
// over plain HTTP, where getRandomValues still works.
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

export function ledgerMoney(cents: number | string, currency: string): string {
  const amount = BigInt(cents)
  const absolute = amount < 0n ? -amount : amount
  return `${currency} ${amount < 0n ? '-' : ''}${String(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`
}

// Whole-site quota totals arrive as decimal strings because they can exceed
// JavaScript's exact integer range; formatNumber only accepts numbers.
export function ledgerQuota(
  value: string,
  locale: Intl.LocalesArgument
): string {
  return Intl.NumberFormat(locale).format(BigInt(value))
}
