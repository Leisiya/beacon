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

export interface CashSummaryData {
  range: {
    period: string
    start_date: string
    end_date: string
    start_at: number
    end_before: number
    as_of: number
  }
  base_currency: 'CNY'
  business_timezone: 'Asia/Shanghai'
  receipt_minor: string
  refund_minor: string
  reversal_minor: string
  net_minor: string
  entry_count: number
  gift_count: number
  receipt_quota: string
  gift_quota: string
  correction_quota: string
  usage_quota: string
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

export type CostGroupBy = 'channel' | 'model' | 'day' | 'user'

// Quota is in quota units and money in millionths of CNY, both as decimal
// strings. Customer charges are valued at the top-up price.
export interface ProfitRow {
  key: string
  label: string
  requests: number
  usage_quota: string
  usage_micro_cny: string
  costed_requests: number
  costed_micro_cny: string
  cost_micro_cny: string
  unmatched_requests: number
  unmatched_cost_micro_cny: string
  pending_requests: number
  profit_micro_cny: string
}

export interface ProfitSummaryData {
  range: CashSummaryData['range']
  group_by: CostGroupBy
  reference_cny_per_unit: number
  total: ProfitRow
  rows: ProfitRow[]
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
