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
import { api } from '@/lib/api'
import { authRequestOptions, authResult } from '@/lib/secure-verification'

import type { CashRangeValues } from './lib/cash-range'
import type {
  BookPage,
  BookSource,
  CostSource,
  CostSyncStatus,
  CustomerFinanceData,
  Expense,
  ExpenseInput,
  FinanceOverview,
  LedgerEntry,
  LedgerInput,
  PricingReport,
  PricingRule,
  PricingRuleInput,
  ProfitGroupBy,
  ProfitSummaryData,
  QuotaReconciliationData,
  UpstreamFinanceData,
  UpstreamPayment,
  UpstreamPaymentInput,
  UpstreamRate,
  UpstreamRateInput,
} from './types'

export function getQuotaReconciliation(): Promise<QuotaReconciliationData> {
  return authResult(
    api.get('/api/beacon/ledger', {
      ...authRequestOptions,
      params: { view: 'reconciliation' },
    })
  )
}

export function getBook(
  source: BookSource | '',
  userId: number,
  cursor: string
): Promise<BookPage> {
  return authResult(
    api.get('/api/beacon/ledger', {
      ...authRequestOptions,
      params: { source, user_id: userId, cursor, limit: 25 },
    })
  )
}

export function postLedger(
  entry: LedgerInput,
  proof: string
): Promise<{ entry: LedgerEntry; created: boolean }> {
  return authResult(
    api.post('/api/beacon/ledger', entry, {
      ...authRequestOptions,
      headers: { 'X-Security-Proof': proof },
    })
  )
}

export function getFinanceOverview(): Promise<FinanceOverview> {
  return authResult(
    api.get('/api/beacon/finance', {
      ...authRequestOptions,
      params: { view: 'overview' },
    })
  )
}

export function getProfitSummary(
  range: CashRangeValues,
  groupBy: ProfitGroupBy
): Promise<ProfitSummaryData> {
  return authResult(
    api.get('/api/beacon/finance', {
      ...authRequestOptions,
      params: { view: 'profit', ...range, group_by: groupBy },
    })
  )
}

export function getCustomerFinance(
  range: CashRangeValues
): Promise<CustomerFinanceData> {
  return authResult(
    api.get('/api/beacon/finance', {
      ...authRequestOptions,
      params: { view: 'customers', ...range },
    })
  )
}

export function getUpstreamFinance(
  range: CashRangeValues
): Promise<UpstreamFinanceData> {
  return authResult(
    api.get('/api/beacon/finance', {
      ...authRequestOptions,
      params: { view: 'upstreams', ...range },
    })
  )
}

export function postUpstreamPayment(
  input: UpstreamPaymentInput
): Promise<{ payment: UpstreamPayment; created: boolean }> {
  return authResult(
    api.post('/api/beacon/finance/payments', input, authRequestOptions)
  )
}

export function postExpense(
  input: ExpenseInput
): Promise<{ expense: Expense; created: boolean }> {
  return authResult(
    api.post('/api/beacon/finance/expenses', input, authRequestOptions)
  )
}

export function getCostSources(): Promise<{
  sources: CostSource[]
  now: number
}> {
  return authResult(api.get('/api/beacon/costs', authRequestOptions))
}

export function postUpstreamRate(
  input: UpstreamRateInput
): Promise<{ rate: UpstreamRate }> {
  return authResult(
    api.post('/api/beacon/costs/rates', input, authRequestOptions)
  )
}

export function postCostSync(): Promise<{
  statuses: Record<string, CostSyncStatus>
}> {
  return authResult(
    api.post('/api/beacon/costs/sync', null, authRequestOptions)
  )
}

export function getPricingReport(): Promise<PricingReport> {
  return authResult(api.get('/api/beacon/pricing', authRequestOptions))
}

export function postPricingRule(
  rule: PricingRuleInput
): Promise<{ rule: PricingRule }> {
  return authResult(
    api.post('/api/beacon/pricing/rules', rule, authRequestOptions)
  )
}

export function deletePricingRule(modelName: string): Promise<unknown> {
  return authResult(
    api.delete('/api/beacon/pricing/rules', {
      ...authRequestOptions,
      params: { model: modelName },
    })
  )
}

export function postPricingEvaluate(): Promise<{
  proposed: string[] | null
  applied: string[] | null
  failed: string[] | null
}> {
  return authResult(
    api.post('/api/beacon/pricing/evaluate', null, authRequestOptions)
  )
}

export function postReferencePrice(
  cnyPerUnit: string
): Promise<{ cny_per_unit: string }> {
  return authResult(
    api.post(
      '/api/beacon/pricing/reference',
      { cny_per_unit: cnyPerUnit },
      authRequestOptions
    )
  )
}

export function postPriceProposal(
  id: number,
  action: 'apply' | 'dismiss'
): Promise<unknown> {
  return authResult(
    api.post(
      `/api/beacon/pricing/proposals/${id}/${action}`,
      null,
      authRequestOptions
    )
  )
}
