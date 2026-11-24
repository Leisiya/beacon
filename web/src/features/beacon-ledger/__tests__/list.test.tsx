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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { BeaconLedger } from '..'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

it('keeps posting and pagination disabled when the ledger is empty in an unsupported quota mode', async () => {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {
      success: true,
      data: {
        items: [],
        next: '',
        posting_available: false,
        base_currency: 'CNY',
        business_timezone: 'Asia/Shanghai',
      },
    },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <BeaconLedger tab='entries' onTabChange={() => {}} />
    </QueryClientProvider>
  )
  await screen.findByText('No ledger entries')
  expect(screen.getByRole('button', { name: 'New entry' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Redis')
})

it('recovers from a failed read and applies the category and customer filters', async () => {
  const filters: { source: string; user_id: number }[] = []
  let fail = true
  api.defaults.adapter = async (config) => {
    if (fail) {
      fail = false
      throw new AxiosError('offline', 'ERR_NETWORK', config)
    }
    filters.push({
      source: config.params.source,
      user_id: config.params.user_id,
    })
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        success: true,
        data: {
          items: [],
          next: '',
          posting_available: true,
          base_currency: 'CNY',
          business_timezone: 'Asia/Shanghai',
        },
      },
    }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <BeaconLedger tab='entries' onTabChange={() => {}} />
    </QueryClientProvider>
  )
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByText('No ledger entries')
  const customer = screen.getByLabelText('Customer ID (blank for all)')
  await user.type(customer, '42')
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  await screen.findByText('No ledger entries')
  // Costs have no customer, so the customer filter is set aside.
  await user.selectOptions(screen.getByLabelText('Category'), 'expense')
  expect(customer).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  await screen.findByText('No ledger entries')
  expect(filters).toEqual([
    { source: '', user_id: 0 },
    { source: '', user_id: 42 },
    { source: 'expense', user_id: 0 },
  ])
})

it('offers a new entry on every tab and reports tab changes', async () => {
  // Finance reports stay loading; only the ledger page answers.
  api.defaults.adapter = (config) =>
    config.url === '/api/beacon/ledger'
      ? Promise.resolve({
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: {
            success: true,
            data: {
              items: [],
              next: '',
              posting_available: true,
              base_currency: 'CNY',
              business_timezone: 'Asia/Shanghai',
            },
          },
        })
      : new Promise(() => {})
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
  const tabs: string[] = []
  const view = render(
    <QueryClientProvider client={client}>
      <BeaconLedger tab='upstreams' onTabChange={(tab) => tabs.push(tab)} />
    </QueryClientProvider>
  )
  // Enabled once the books confirm customer entries can be posted.
  const entry = await screen.findByRole('button', { name: 'New entry' })
  await waitFor(() => expect(entry).toBeEnabled())
  await user.click(screen.getByRole('tab', { name: 'Customers' }))
  expect(tabs).toEqual(['customers'])
  view.rerender(
    <QueryClientProvider client={client}>
      <BeaconLedger tab='customers' onTabChange={(tab) => tabs.push(tab)} />
    </QueryClientProvider>
  )
  expect(screen.getByRole('button', { name: 'New entry' })).toBeEnabled()
})
