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
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { FinanceOverview } from '../components/finance-overview'
import type {
  FinanceOverview as FinanceOverviewData,
  FinanceTab,
} from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

const overview: FinanceOverviewData = {
  as_of: 1795521600,
  today: {
    revenue_micro_cny: '2000000',
    cost_micro_cny: '4000000',
    expense_micro_cny: '0',
    profit_micro_cny: '-2000000',
  },
  month: {
    revenue_micro_cny: '35000000',
    cost_micro_cny: '8000000',
    expense_micro_cny: '3000000',
    profit_micro_cny: '24000000',
  },
  all: {
    revenue_micro_cny: '135000000',
    cost_micro_cny: '18000000',
    expense_micro_cny: '13000000',
    profit_micro_cny: '104000000',
  },
  customer_paid_micro_cny: '1000000000',
  customer_used_micro_cny: '135000000',
  customer_remaining_micro_cny: '865000000',
  upstream_paid_micro_cny: '300000000',
  upstream_used_micro_cny: '18000000',
  upstream_remaining_micro_cny: '282000000',
  cash_micro_cny: '687000000',
  pending_charges: 2,
}

function renderOverview(opened: FinanceTab[]) {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: overview },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <FinanceOverview onOpen={(tab) => opened.push(tab)} />
    </QueryClientProvider>
  )
}

it('shows profit, customer payments, upstream payments, other costs and the money on hand', async () => {
  renderOverview([])
  expect(
    await screen.findByRole('heading', { name: 'Paid by customers' })
  ).toBeInTheDocument()
  expect(screen.getByText('-¥2.00')).toHaveClass('text-destructive')
  expect(screen.getByText('¥24.00')).toBeInTheDocument()
  expect(screen.getByText('¥104.00')).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Other costs' })
  ).toBeInTheDocument()
  expect(screen.getByText('¥3.00')).toBeInTheDocument()
  expect(screen.getAllByText('¥1,000.00')[0]).toBeInTheDocument()
  expect(screen.getByText('¥865.00')).toBeInTheDocument()
  expect(screen.getAllByText('¥300.00')[0]).toBeInTheDocument()
  expect(screen.getByText('¥282.00')).toBeInTheDocument()
  expect(screen.getByText('¥687.00')).toBeInTheDocument()
  expect(screen.getByText(/This is not profit/)).toHaveTextContent(
    'Paid by customers ¥1,000.00 − paid to upstreams ¥300.00 − other costs ¥13.00'
  )
  expect(
    screen.getByText(/2 upstream deductions have no purchase price/)
  ).toBeInTheDocument()
})

it('opens the detail tab behind each headline number', async () => {
  const opened: FinanceTab[] = []
  renderOverview(opened)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Profit by day' }))
  await user.click(screen.getByRole('button', { name: 'Each customer' }))
  await user.click(screen.getByRole('button', { name: 'Each upstream' }))
  await user.click(screen.getByRole('button', { name: 'Ledger entries' }))
  expect(opened).toEqual(['profit', 'customers', 'upstreams', 'entries'])
})
