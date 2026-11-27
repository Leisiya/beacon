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

// Operating expenses count against profit on the day they are paid.
export type ExpenseCategory = 'server' | 'promotion' | 'other'

// What a new entry is for: customer money, a top-up paid to an upstream or
// an operating expense.
export type EntryKind = LedgerKind | 'upstream' | ExpenseCategory

export type BookSource = 'customer' | 'upstream' | 'expense'

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
  occurred_at: number
  recorded_at: number
  note: string
}

// One row of the books; correction_id is the row that refunded or reversed it.
export type BookEntry =
  | { source: 'customer'; correction_id: number | null; customer: LedgerEntry }
  | {
      source: 'upstream'
      correction_id: number | null
      upstream: UpstreamPayment
      channel_name?: string
    }
  | { source: 'expense'; correction_id: number | null; expense: Expense }

export interface BookPage {
  items: BookEntry[]
  // Cursor of the next page, empty on the last page.
  next: string
  posting_available: boolean
  base_currency: 'CNY'
  business_timezone: 'Asia/Shanghai'
}

// Asia/Shanghai calendar dates covered by a report.
export interface ReportRange {
  period: string
  start_date: string
  end_date: string
  start_at: number
  end_before: number
  as_of: number
}

interface QuotaMismatch {
  user_id: number
  username: string
  ledger_quota: number
  balance_quota: number
  used_quota: number
  difference: number
}

export interface QuotaReconciliationData {
  as_of: number
  ledger_quota: string
  balance_quota: string
  used_quota: string
  difference: string
  mismatch_count: number
  mismatches: QuotaMismatch[]
}

export type FinanceTab =
  | 'overview'
  | 'profit'
  | 'customers'
  | 'upstreams'
  | 'entries'
  | 'reconciliation'

export type ProfitGroupBy = 'day' | 'user' | 'model' | 'channel'

// Money is in millionths of CNY and quota in quota units, both as decimal
// strings so totals stay exact.
export interface ProfitRow {
  key: string
  label: string
  requests: number
  usage_quota: string
  revenue_micro_cny: string
  cost_micro_cny: string
  expense_micro_cny: string
  profit_micro_cny: string
}

export interface ProfitSummaryData {
  range: ReportRange
  group_by: ProfitGroupBy
  total: ProfitRow
  rows: ProfitRow[]
  // Used from gifted balance, which earns nothing.
  gift_quota: string
  // Used with no recorded payment behind it.
  unpaid_quota: string
  pending_charges: number
  uncosted_requests: number
}

export interface ProfitTotals {
  revenue_micro_cny: string
  cost_micro_cny: string
  expense_micro_cny: string
  profit_micro_cny: string
}

// Customer and supplier totals are all time.
export interface FinanceOverview {
  as_of: number
  today: ProfitTotals
  month: ProfitTotals
  all: ProfitTotals
  customer_paid_micro_cny: string
  customer_used_micro_cny: string
  customer_remaining_micro_cny: string
  upstream_paid_micro_cny: string
  upstream_used_micro_cny: string
  upstream_remaining_micro_cny: string
  cash_micro_cny: string
  pending_charges: number
}

// Paid and used cover the period; remaining and balance are now.
export interface CustomerFinanceRow {
  user_id: number
  username: string
  paid_micro_cny: string
  used_micro_cny: string
  usage_quota: string
  gift_quota: string
  unpaid_quota: string
  remaining_micro_cny: string
  balance_quota: string
}

export interface CustomerFinanceData {
  range: ReportRange
  total: CustomerFinanceRow
  rows: CustomerFinanceRow[]
}

// Credit is in millionths of the upstream's $1. Remaining is all time.
export interface UpstreamFinanceRow {
  channel_id: number
  name: string
  paid_micro_cny: string
  paid_credit_micro: string
  used_micro_cny: string
  used_credit_micro: string
  pending_charges: number
  remaining_micro_cny: string
  remaining_credit_micro: string
  cny_per_unit: string
  reported_balance: number
  reported_at: number
}

export interface UpstreamFinanceData {
  range: ReportRange
  total: UpstreamFinanceRow
  rows: UpstreamFinanceRow[]
}

export interface UpstreamPayment {
  id: number
  kind: 'payment' | 'reversal'
  channel_id: number
  cny_amount_minor: number
  credit_micro: number
  corrects_id: number | null
  occurred_at: number
  operator_id: number
  recorded_at: number
  note: string
}

export interface UpstreamPaymentInput {
  request_key: string
  channel_id: number
  amount: string
  credit: string
  corrects_id: number
  occurred_at: number
  note: string
}

export interface Expense {
  id: number
  kind: 'expense' | 'reversal'
  category: ExpenseCategory
  cny_amount_minor: number
  corrects_id: number | null
  occurred_at: number
  operator_id: number
  recorded_at: number
  note: string
}

export interface ExpenseInput {
  request_key: string
  category: ExpenseCategory | ''
  amount: string
  corrects_id: number
  occurred_at: number
  note: string
}

export interface UpstreamRate {
  id: number
  channel_id: number
  effective_at: number
  cny_per_unit: string
  operator_id: number
  recorded_at: number
  note: string
}

export interface UpstreamRateInput {
  channel_id: number
  effective_at: number
  cny_per_unit: string
  note: string
}

export interface CostSyncStatus {
  channel_id: number
  last_attempt_at: number
  last_success_at: number
  last_error: string
  fetched: number
  inserted: number
}

export interface CostSource {
  id: number
  name: string
  type: number
  status: number
  base_url: string
  rates: UpstreamRate[]
  observation: {
    occurred_at: number
    upstream_group: string
    group_ratio: string
  } | null
  sync: CostSyncStatus | null
}

export type PricingMode = 'cost_plus' | 'fixed'

// Percentages are basis points: 3000 means 30%.
export interface PricingRule {
  id: number
  model_name: string
  mode: PricingMode
  markup_bp: number
  min_markup_bp: number
  auto_apply: boolean
  follow_down: boolean
  max_step_bp: number
  updated_at: number
  operator_id: number
}

export type PricingRuleInput = Omit<
  PricingRule,
  'id' | 'updated_at' | 'operator_id'
>

// CNY per 1M tokens, or per request when kind is "request".
export interface PriceLine {
  kind: string
  context: number
  cost_cny: number
  sale_cny: number
  markup_bp: number | null
}

export interface ChannelCost {
  channel_id: number
  channel_name: string
  upstream_model: string
  status: 'ok' | 'no_rate' | 'no_observation' | 'unsupported'
  cny_per_unit: string
  upstream_group: string
  group_ratio: string
  source: string
  observed_at: number
  verified_count: number
  mismatch_count: number
  min_markup_bp: number | null
  lines: PriceLine[]
}

export interface ModelPricing {
  model_name: string
  status: 'ok' | 'legacy_pricing' | 'no_cost' | 'free_sale' | 'unsupported_expr'
  sale_expr: string
  rule: PricingRule
  rule_overridden: boolean
  channels: ChannelCost[]
  basis_channel_id: number
  current_markup_bp: number | null
  below_minimum: boolean
  factor: string
  proposed_expr: string
  // What customers pay on top of the model price: the lowest ratio among the
  // groups that sell the model.
  group_ratio: number
  // CNY sale price per usage type at standard context.
  sale: PriceLine[]
}

export interface PriceProposal {
  id: number
  model_name: string
  status: 'pending' | 'applied' | 'dismissed' | 'superseded' | 'failed'
  created_at: number
  decided_at: number
  decider_id: number
  automatic: boolean
  basis_channel_id: number
  factor: string
  current_markup_bp: number
  target_markup_bp: number
  old_expr: string
  new_expr: string
  detail: string
  error: string
}

export interface PricingReport {
  reference_cny_per_unit: number
  default_group_ratio: number
  default_rule: PricingRule
  overrides: PricingRule[]
  models: ModelPricing[]
  proposals: PriceProposal[]
  history: PriceProposal[]
}
