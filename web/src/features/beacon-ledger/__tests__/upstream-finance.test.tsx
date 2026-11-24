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

import { UpstreamFinance } from '../components/upstream-finance'
import type { UpstreamFinanceData, UpstreamFinanceRow } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

const supplier: UpstreamFinanceRow = {
  channel_id: 3,
  name: 'novaris',
  paid_micro_cny: '50000000',
  paid_credit_micro: '40000000',
  used_micro_cny: '58000000',
  used_credit_micro: '46400000',
  pending_charges: 0,
  remaining_micro_cny: '-8000000',
  remaining_credit_micro: '-6400000',
  cny_per_unit: '1.25',
  reported_balance: 5.275924,
  reported_at: 1795795200,
}

const report: UpstreamFinanceData = {
  range: {
    period: 'all',
    start_date: '2000-01-01',
    end_date: '2026-11-22',
    start_at: 946656000,
    end_before: 1795795201,
    as_of: 1795795200,
  },
  total: { ...supplier, channel_id: 0, name: 'total' },
  rows: [supplier],
}

function renderUpstreams(topUps: number[]) {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: report },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpstreamFinance onTopUp={(channelId) => topUps.push(channelId)} />
    </QueryClientProvider>
  )
}

it('shows what is left with each upstream next to the balance it reports', async () => {
  renderUpstreams([])
  expect(await screen.findByText('novaris')).toBeInTheDocument()
  expect(screen.getAllByText('-¥8.00')[0]).toBeInTheDocument()
  expect(screen.getByText('-$6.40')).toBeInTheDocument()
  expect(screen.getByText('$5.28')).toBeInTheDocument()
})

it('records a top-up through the shared new entry form for that upstream', async () => {
  const topUps: number[] = []
  renderUpstreams(topUps)
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Record a top-up to novaris' })
  )
  expect(topUps).toEqual([3])
})
