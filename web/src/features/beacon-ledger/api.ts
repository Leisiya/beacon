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
  CashSummaryData,
  CostGroupBy,
  CostSource,
  CostSummaryData,
  CostSyncStatus,
  LedgerEntry,
  LedgerInput,
  LedgerPage,
  QuotaReconciliationData,
  UpstreamRate,
  UpstreamRateInput,
} from './types'

export function getCashSummary(
  range: CashRangeValues
): Promise<CashSummaryData> {
  return authResult(
    api.get('/api/beacon/ledger', {
      ...authRequestOptions,
      params: { view: 'cash_summary', ...range },
    })
  )
}

export function getQuotaReconciliation(): Promise<QuotaReconciliationData> {
  return authResult(
    api.get('/api/beacon/ledger', {
      ...authRequestOptions,
      params: { view: 'reconciliation' },
    })
  )
}

export function getLedger(userId: number, before: number): Promise<LedgerPage> {
  return authResult(
    api.get('/api/beacon/ledger', {
      ...authRequestOptions,
      params: { user_id: userId, before, limit: 25 },
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

export function getCostSummary(
  range: CashRangeValues,
  groupBy: CostGroupBy
): Promise<CostSummaryData> {
  return authResult(
    api.get('/api/beacon/costs', {
      ...authRequestOptions,
      params: { ...range, group_by: groupBy },
    })
  )
}

export function getCostSources(): Promise<{
  sources: CostSource[]
  now: number
}> {
  return authResult(
    api.get('/api/beacon/costs', {
      ...authRequestOptions,
      params: { view: 'sources' },
    })
  )
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
