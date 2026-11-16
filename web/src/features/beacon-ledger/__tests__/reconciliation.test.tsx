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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { QuotaReconciliation } from '../components/quota-reconciliation'
import type { QuotaReconciliationData } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

const balanced: QuotaReconciliationData = {
  as_of: 1767412800,
  ledger_quota: '500',
  balance_quota: '380',
  used_quota: '120',
  difference: '0',
  mismatch_count: 0,
  mismatches: [],
}

function respondWith(data: QuotaReconciliationData) {
  const requests: Record<string, string>[] = []
  api.defaults.adapter = async (config) => {
    requests.push(config.params)
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
  return requests
}

function renderReport() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <QuotaReconciliation />
    </QueryClientProvider>
  )
}

it('confirms reconciliation and shows no account table when every balance matches the ledger', async () => {
  const requests = respondWith(balanced)

  renderReport()

  expect(
    await screen.findByText('Every account reconciles with the ledger.')
  ).toBeInTheDocument()
  expect(screen.getByText('380')).toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Accounts that do not reconcile' })
  ).not.toBeInTheDocument()
  expect(requests[0]).toEqual({ view: 'reconciliation' })
})

it('lists each mismatched account with its quota figures when balances drift from the ledger', async () => {
  respondWith({
    ...balanced,
    difference: '45',
    mismatch_count: 2,
    mismatches: [
      {
        user_id: 7,
        username: 'alice',
        ledger_quota: 0,
        balance_quota: 75,
        used_quota: 0,
        difference: 75,
      },
      {
        user_id: 424242,
        username: '',
        ledger_quota: 30,
        balance_quota: 0,
        used_quota: 0,
        difference: -30,
      },
    ],
  })

  renderReport()

  const table = await screen.findByRole('region', {
    name: 'Accounts that do not reconcile',
  })
  expect(within(table).getByText('7 · alice')).toBeInTheDocument()
  expect(within(table).getByText('424,242')).toBeInTheDocument()
  expect(within(table).getByText('-30')).toBeInTheDocument()
  expect(
    screen.queryByText('Every account reconciles with the ledger.')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Showing the first/)
  ).not.toBeInTheDocument()
})

it('tells the operator the list is truncated when more accounts mismatch than are returned', async () => {
  respondWith({
    ...balanced,
    difference: '5',
    mismatch_count: 150,
    mismatches: [
      {
        user_id: 1,
        username: 'root',
        ledger_quota: 0,
        balance_quota: 5,
        used_quota: 0,
        difference: 5,
      },
    ],
  })

  renderReport()

  expect(
    await screen.findByText('Showing the first 1 of 150 accounts.')
  ).toBeInTheDocument()
})

it('shows no figures after a failed load and renders the report after retrying', async () => {
  let fail = true
  api.defaults.adapter = async (config) => {
    if (fail) {
      fail = false
      throw new AxiosError('offline', 'ERR_NETWORK', config)
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data: balanced },
    }
  }
  const user = userEvent.setup()
  renderReport()

  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(
    screen.queryByText('Every account reconciles with the ledger.')
  ).not.toBeInTheDocument()
  await user.click(retry)

  expect(
    await screen.findByText('Every account reconciles with the ledger.')
  ).toBeInTheDocument()
})
