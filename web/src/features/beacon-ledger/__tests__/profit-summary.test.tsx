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

const total: ProfitRow = {
  key: 'total',
  label: 'total',
  requests: 4,
  usage_quota: '650000',
  revenue_micro_cny: '35000000',
  cost_micro_cny: '8000000',
  expense_micro_cny: '3000000',
  profit_micro_cny: '24000000',
}

function summary(groupBy: ProfitSummaryData['group_by']): ProfitSummaryData {
  const rows: ProfitRow[] =
    groupBy === 'user'
      ? [
          {
            key: '0',
            label: '0',
            requests: 0,
            usage_quota: '0',
            revenue_micro_cny: '0',
            cost_micro_cny: '1000000',
            expense_micro_cny: '0',
            profit_micro_cny: '-1000000',
          },
          {
            ...total,
            key: '7',
            label: 'alice',
            cost_micro_cny: '7000000',
            expense_micro_cny: '0',
            profit_micro_cny: '28000000',
          },
          {
            key: 'expenses',
            label: 'expenses',
            requests: 0,
            usage_quota: '0',
            revenue_micro_cny: '0',
            cost_micro_cny: '0',
            expense_micro_cny: '3000000',
            profit_micro_cny: '-3000000',
          },
        ]
      : [
          {
            ...total,
            key: '2026-11-19',
            label: '2026-11-19',
            requests: 3,
            revenue_micro_cny: '20000000',
            cost_micro_cny: '4000000',
            expense_micro_cny: '3000000',
            profit_micro_cny: '13000000',
          },
          {
            ...total,
            key: '2026-11-18',
            label: '2026-11-18',
            requests: 1,
            revenue_micro_cny: '15000000',
            cost_micro_cny: '4000000',
            expense_micro_cny: '0',
            profit_micro_cny: '11000000',
          },
        ]
  return {
    range,
    group_by: groupBy,
    total,
    rows,
    gift_quota: '250000',
    unpaid_quota: '50000',
    pending_charges: 1,
    uncosted_requests: 2,
  }
}

function renderProfit(requests: Record<string, string>[]) {
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
  render(
    <QueryClientProvider client={client}>
      <ProfitSummary />
    </QueryClientProvider>
  )
}

it('shows this month’s profit by day after other costs and says what earns nothing or lacks a cost', async () => {
  const requests: Record<string, string>[] = []
  renderProfit(requests)
  expect((await screen.findAllByText('¥35.00'))[0]).toBeInTheDocument()
  expect(screen.getAllByText('¥24.00')[0]).toBeInTheDocument()
  expect(screen.getAllByText('68.6%')[0]).toBeInTheDocument()
  expect(screen.getByText('2026-11-19')).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Other costs' })
  ).toBeInTheDocument()
  expect(screen.getAllByText('¥3.00')).toHaveLength(2)
  expect(screen.getByText('¥13.00')).toBeInTheDocument()
  expect(screen.getByText(/of gifted balance was used/)).toBeInTheDocument()
  expect(
    screen.getByText(/was used with no recorded payment/)
  ).toBeInTheDocument()
  expect(
    screen.getByText(/1 upstream deductions have no purchase price/)
  ).toBeInTheDocument()
  expect(
    screen.getByText(/2 requests went through channels with no purchase price/)
  ).toBeInTheDocument()
  expect(requests[0]).toMatchObject({
    view: 'profit',
    period: 'month',
    group_by: 'day',
  })
})

it('labels deductions with no request on this site, other costs and a loss', async () => {
  const requests: Record<string, string>[] = []
  renderProfit(requests)
  const user = userEvent.setup()
  await screen.findByText('2026-11-19')
  await user.selectOptions(screen.getByLabelText('Group by'), 'user')
  await user.click(screen.getByRole('button', { name: 'Apply range' }))
  expect(await screen.findByText('No request on this site')).toBeInTheDocument()
  expect(screen.getByText('alice')).toBeInTheDocument()
  expect(screen.getByText('-¥1.00')).toHaveClass('text-destructive')
  // Other costs belong to no customer and get a row of their own.
  expect(screen.getByRole('cell', { name: 'Other costs' })).toBeInTheDocument()
  expect(screen.getByText('-¥3.00')).toHaveClass('text-destructive')
  expect(requests.at(-1)).toMatchObject({ group_by: 'user' })
})
