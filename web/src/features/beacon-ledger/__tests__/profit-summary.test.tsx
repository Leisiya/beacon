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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { ProfitSummary } from '../components/profit-summary'
import type { ProfitRow, ProfitSummaryData } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

const range: ProfitSummaryData['range'] = {
  period: 'month',
  start_date: '2026-11-01',
  end_date: '2026-11-21',
  start_at: 1793462400,
  end_before: 1795276801,
  as_of: 1795276800,
}

// One costed request, one request with no cost yet, one deduction with no
// local request and one deduction without a purchase price.
const total: ProfitRow = {
  key: 'total',
  label: 'total',
  requests: 2,
  usage_quota: '1121',
  usage_micro_cny: '16367',
  costed_requests: 1,
  costed_micro_cny: '3227',
  cost_micro_cny: '794',
  unmatched_requests: 1,
  unmatched_cost_micro_cny: '21860',
  pending_requests: 1,
  profit_micro_cny: '-19427',
}

function summary(groupBy: ProfitSummaryData['group_by']): ProfitSummaryData {
  const rows: ProfitRow[] =
    groupBy === 'user'
      ? [
          {
            ...total,
            key: '0',
            label: '0',
            requests: 0,
            usage_quota: '0',
            usage_micro_cny: '0',
            costed_requests: 0,
            costed_micro_cny: '0',
            cost_micro_cny: '0',
            profit_micro_cny: '-21860',
          },
          {
            ...total,
            key: '7',
            label: 'alice',
            unmatched_requests: 0,
            unmatched_cost_micro_cny: '0',
            pending_requests: 0,
            profit_micro_cny: '2433',
          },
        ]
      : [{ ...total, key: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' }]
  return {
    range,
    group_by: groupBy,
    reference_cny_per_unit: 7.3,
    total,
    rows,
  }
}

it('shows estimated profit from costed requests and explains what is left out', async () => {
  const requests: Record<string, string>[] = []
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    requests.push(config.params)
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data: summary(config.params.group_by) },
    }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ProfitSummary />
    </QueryClientProvider>
  )
  expect((await screen.findAllByText('¥0.0164'))[0]).toBeInTheDocument()
  expect(screen.getAllByText('-¥0.0194')[0]).toBeInTheDocument()
  expect(screen.getAllByText('-602%')[0]).toBeInTheDocument()
  expect(
    screen.getByText(/1 requests have no upstream cost yet/)
  ).toBeInTheDocument()
  expect(
    screen.getByText(/\(¥0\.0219\) have no matching request/)
  ).toBeInTheDocument()
  expect(
    screen.getByText(/1 upstream deductions have no purchase price/)
  ).toBeInTheDocument()
  expect(screen.getByText(/top-up price of ¥7.3 per \$1/)).toBeInTheDocument()
  expect(requests[0]).toMatchObject({ period: 'month', group_by: 'model' })

  await user.selectOptions(screen.getByLabelText('Group by'), 'user')
  await user.click(screen.getByRole('button', { name: 'Apply range' }))
  expect(await screen.findByText('No request on this site')).toBeInTheDocument()
  expect(screen.getByText('alice')).toBeInTheDocument()
  expect(screen.getByText('-¥0.0219')).toHaveClass('text-destructive')
  expect(requests.at(-1)).toMatchObject({ group_by: 'user' })
})
