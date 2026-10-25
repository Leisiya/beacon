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
export type LedgerKind = 'receipt' | 'gift' | 'refund' | 'reversal'

export interface LedgerInput {
  idempotency_key: string
  kind: LedgerKind
  user_id: number
  amount: string
  currency: string
  cny_per_unit: string
  fx_source: string
  quota: number
  payment_method: string
  payment_reference: string
  corrects_id: number
  occurred_at: number
  note: string
}

export interface LedgerEntry {
  id: number
  idempotency_key: string
  kind: LedgerKind
  user_id: number
  operator_id: number
  currency: string
  original_amount_minor: number
  cny_amount_minor: number
  cny_per_unit: string
  fx_source: string
  quota_delta: number
  payment_method: string
  payment_reference: string
  corrects_id: number | null
  correction_id: number | null
  occurred_at: number
  recorded_at: number
  note: string
}

export interface LedgerPage {
  items: LedgerEntry[]
  next_before: number
  posting_available: boolean
  base_currency: 'CNY'
  business_timezone: 'Asia/Shanghai'
}
