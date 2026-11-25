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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { CustomerFinance } from '../components/customer-finance'
import type { CustomerFinanceData, CustomerFinanceRow } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

const alice: CustomerFinanceRow = {
  user_id: 7,
  username: 'alice',
  paid_micro_cny: '100000000',
  used_micro_cny: '35000000',
  usage_quota: '600000',
  gift_quota: '250000',
  unpaid_quota: '0',
  remaining_micro_cny: '65000000',
  balance_quota: '650000',
}

function report(rows: CustomerFinanceRow[]): CustomerFinanceData {
  return {
    range: {
      period: 'all',
      start_date: '2000-01-01',
      end_date: '2026-11-22',
      start_at: 946656000,
      end_before: 1795795201,
      as_of: 1795795200,
    },
    total: { ...alice, user_id: 0, username: 'total', unpaid_quota: '50000' },
    rows,
  }
}

function renderCustomers(
  requests: Record<string, string>[],
  rows: CustomerFinanceRow[] = [alice],
  onRefund = vi.fn()
) {
  api.defaults.adapter = async (config) => {
    requests.push(config.params)
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data: report(rows) },
    }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CustomerFinance onRefund={onRefund} />
    </QueryClientProvider>
  )
}

it('lists what each customer paid, used and has left, all time by default', async () => {
  const requests: Record<string, string>[] = []
  renderCustomers(requests)
  expect(await screen.findByText('alice')).toBeInTheDocument()
  expect(screen.getByText('#7')).toBeInTheDocument()
  expect(screen.getAllByText('¥100.00')).toHaveLength(2)
  expect(screen.getAllByText('¥65.00')).toHaveLength(2)
  expect(
    screen.getByText(/was used with no recorded payment/)
  ).toBeInTheDocument()
  expect(requests[0]).toMatchObject({ view: 'customers', period: 'all' })
})

it('starts a refund preset to the customer and what they paid for but have not used', async () => {
  const onRefund = vi.fn()
  const bob = {
    ...alice,
    user_id: 8,
    username: '',
    remaining_micro_cny: '-1500000',
  }
  renderCustomers(
    [],
    [{ ...alice, remaining_micro_cny: '65004999' }, bob],
    onRefund
  )
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Record a refund to alice' })
  )
  expect(onRefund).toHaveBeenLastCalledWith(7, '65.00')
  // Nothing left unused: the amount is left for the operator to fill in.
  await user.click(
    screen.getByRole('button', { name: 'Record a refund to #8' })
  )
  expect(onRefund).toHaveBeenLastCalledWith(8, '')
})

it('explains an empty list instead of showing an empty table', async () => {
  renderCustomers([], [])
  expect(
    await screen.findByText('No customer activity yet')
  ).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('validates custom dates before requesting and then applies the chosen range', async () => {
  const requests: Record<string, string>[] = []
  renderCustomers(requests)
  const user = userEvent.setup()
  await screen.findByText('alice')
  await user.selectOptions(screen.getByLabelText('Reporting period'), 'custom')
  await user.type(screen.getByLabelText('Start date (Shanghai)'), '2026-01-03')
  await user.type(screen.getByLabelText('End date (Shanghai)'), '2026-01-02')
  await user.click(screen.getByRole('button', { name: 'Apply range' }))
  expect(screen.getByLabelText('End date (Shanghai)')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(requests).toHaveLength(1)
  await user.clear(screen.getByLabelText('End date (Shanghai)'))
  await user.type(screen.getByLabelText('End date (Shanghai)'), '2026-01-04')
  await user.click(screen.getByRole('button', { name: 'Apply range' }))
  await screen.findByText('alice')
  expect(requests.at(-1)).toMatchObject({
    view: 'customers',
    period: 'custom',
    start: '2026-01-03',
    end: '2026-01-04',
  })
})
