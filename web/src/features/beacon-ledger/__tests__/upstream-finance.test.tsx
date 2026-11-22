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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamFinance } from '../components/upstream-finance'
import type {
  UpstreamFinanceData,
  UpstreamFinanceRow,
  UpstreamPayment,
} from '../types'

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

const payment: UpstreamPayment = {
  id: 11,
  kind: 'payment',
  channel_id: 3,
  cny_amount_minor: 5000,
  credit_micro: 40000000,
  corrects_id: null,
  occurred_at: 1795700000,
  operator_id: 1,
  recorded_at: 1795700000,
  note: 'first top-up',
  reversal_id: null,
}

function renderUpstreams(posts: unknown[]) {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    let data: unknown = report
    if (config.method === 'post') {
      posts.push(JSON.parse(config.data))
      data = { payment, created: true }
    } else if (config.params?.view === 'payments') {
      data = { items: [payment] }
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpstreamFinance />
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

it('records a payment with the credit filled in from the purchase price', async () => {
  const posts: unknown[] = []
  renderUpstreams(posts)
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Payments to novaris' })
  )
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText('CNY paid')
  await user.type(amount, '0')
  await user.click(
    within(dialog).getByRole('button', { name: 'Record payment' })
  )
  expect(amount).toHaveAttribute('aria-invalid', 'true')
  expect(posts).toEqual([])
  await user.clear(amount)
  await user.type(amount, '100')
  expect(
    within(dialog).getByLabelText('Credit received (upstream $)')
  ).toHaveValue('80')
  await user.type(within(dialog).getByLabelText('Note'), 'top-up')
  await user.click(
    within(dialog).getByRole('button', { name: 'Record payment' })
  )
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toMatchObject({
    channel_id: 3,
    amount: '100',
    credit: '80',
    corrects_id: 0,
    note: 'top-up',
  })
  expect((posts[0] as { request_key: string }).request_key).toMatch(
    /^[a-z0-9][a-z0-9_-]{15,63}$/
  )
})

it('reverses a payment only with a reason', async () => {
  const posts: unknown[] = []
  renderUpstreams(posts)
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Payments to novaris' })
  )
  await user.click(
    await screen.findByRole('button', { name: 'Reverse payment of ¥50.00' })
  )
  const confirm = await screen.findByRole('alertdialog')
  const reverse = within(confirm).getByRole('button', { name: 'Reverse' })
  expect(reverse).toBeDisabled()
  await user.type(within(confirm).getByLabelText('Reason'), 'entered twice')
  await user.click(reverse)
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toMatchObject({
    corrects_id: 11,
    channel_id: 0,
    amount: '',
    credit: '',
    note: 'entered twice',
  })
})
