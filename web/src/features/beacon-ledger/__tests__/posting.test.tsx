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
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { LedgerEntryDialog } from '../components/ledger-entry-dialog'
import { LedgerTable } from '../components/ledger-table'
import type { BookEntry, EntryKind, LedgerEntry } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
  useAuthStore.getState().auth.reset('idle')
})

function setupDialog(
  onComplete = vi.fn(),
  kind: EntryKind = 'gift',
  channelId?: number
): void {
  const now = Math.floor(Date.now() / 1000)
  useAuthStore.getState().auth.setBundle({
    access_token: 'test-browser-token',
    token_type: 'Bearer',
    access_expires_at: now + 600,
    user: { id: 1, username: 'operator', role: 100 },
    session: {
      sid: 'test-session',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'test',
      created_at: now,
      last_active_at: now,
      expires_at: now + 3600,
    },
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const route = createRootRoute({
    component: () => (
      <LedgerEntryDialog
        open
        kind={kind}
        channelId={channelId}
        onOpenChange={() => {}}
        onComplete={onComplete}
      />
    ),
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

async function reviewGift(
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user.type(await screen.findByLabelText('Customer ID'), '42')
  await user.type(screen.getByLabelText('Balance to credit (USD)'), '5')
  await user.click(screen.getByRole('button', { name: 'Review entry' }))
  await screen.findByRole('alertdialog', { name: 'Confirm ledger entry' })
}

it('does not send a ledger mutation when the operator cancels security verification', async () => {
  const requests: string[] = []
  api.defaults.adapter = async (config) => {
    requests.push(config.url ?? '')
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        success: true,
        data: {
          scope: 'beacon.ledger.post',
          methods: [{ method: 'password', available: true }],
          oauth_providers: [],
          password_encryption_enabled: false,
        },
      },
    }
  }
  const user = userEvent.setup()
  setupDialog()
  await reviewGift(user)
  await user.click(screen.getByRole('button', { name: 'Verify and post' }))
  await screen.findByLabelText('Password', { selector: 'input' })
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await screen.findByRole('alertdialog', { name: 'Confirm ledger entry' })
  expect(requests.filter((url) => url !== '/api/status')).toEqual([
    '/api/verify/methods',
  ])
})

it('retries an uncertain submission with the exact same entry and a fresh proof', async () => {
  const posted: { body: string; proof: unknown }[] = []
  let proofs = 0
  const adapter: AxiosAdapter = async (config) => {
    let data: unknown
    if (config.url === '/api/verify/methods') {
      data = {
        scope: 'beacon.ledger.post',
        methods: [{ method: 'password', available: true }],
        oauth_providers: [],
        password_encryption_enabled: false,
      }
    } else if (config.url === '/api/verify') {
      proofs++
      data = {
        proof_token: `proof-${proofs}`,
        expires_at: Math.floor(Date.now() / 1000) + 60,
        method: 'password',
        scope: 'beacon.ledger.post',
      }
    } else if (config.url === '/api/beacon/ledger') {
      posted.push({
        body: config.data,
        proof: config.headers['X-Security-Proof'],
      })
      if (posted.length === 1) {
        throw new AxiosError('network interrupted', 'ERR_NETWORK', config)
      }
      if (posted.length === 2) {
        throw new AxiosError(
          'proof expired',
          'ERR_BAD_REQUEST',
          config,
          undefined,
          {
            config,
            status: 403,
            statusText: 'Forbidden',
            headers: {},
            data: { success: false, code: 'SECURITY_PROOF_EXPIRED' },
          }
        )
      }
      data = { entry: { id: 17 }, created: false }
    } else throw new Error('Unexpected request')
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
  api.defaults.adapter = adapter
  const done = vi.fn()
  const user = userEvent.setup()
  setupDialog(done)
  await reviewGift(user)
  await user.click(screen.getByRole('button', { name: 'Verify and post' }))
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'test-password'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  const retry = await screen.findByRole('button', { name: 'Retry same entry' })
  expect(done).not.toHaveBeenCalled()
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  await user.click(retry)
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'test-password'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  await user.click(
    await screen.findByRole('button', { name: 'Retry same entry' })
  )
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'test-password'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
  expect(posted).toHaveLength(3)
  expect(posted[0].body).toBe(posted[1].body)
  expect(posted[0].body).toBe(posted[2].body)
  expect(posted.map((request) => request.proof)).toEqual([
    'proof-1',
    'proof-2',
    'proof-3',
  ])
})

it('prefills a receipt with its top-up price value and keeps a balance the operator types', async () => {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {
      success: true,
      data: config.url === '/api/status' ? { price: 7.3 } : {},
    },
  })
  const user = userEvent.setup()
  setupDialog(vi.fn(), 'receipt')
  const credit = await screen.findByLabelText('Balance to credit (USD)')
  const amount = screen.getByLabelText('Original currency amount')
  // The payment is entered before the balance it prefills.
  expect(
    amount.compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()

  await user.type(amount, '73')
  await waitFor(() => expect(credit).toHaveValue('10'))
  expect(
    screen.getByText('Customer balance +$10 (5,000,000 quota units)')
  ).toBeInTheDocument()

  await user.clear(credit)
  await user.type(credit, '12')
  await user.type(amount, '0')
  expect(credit).toHaveValue('12')
  expect(
    screen.getByText(/At the top-up price this payment buys \$100;/)
  ).toBeInTheDocument()
})

it('makes corrected records read-only while keeping complete details keyboard-accessible', async () => {
  const row: LedgerEntry = {
    id: 1,
    idempotency_key: 'test-request-0001',
    kind: 'receipt',
    user_id: 42,
    operator_id: 1,
    currency: 'CNY',
    original_amount_minor: 1234,
    cny_amount_minor: 1234,
    cny_per_unit: '1',
    fx_source: 'bank',
    quota_delta: 500,
    payment_method: 'bank',
    payment_reference: 'long-reference-'.repeat(6),
    corrects_id: null,
    occurred_at: 1767317400,
    recorded_at: 1767317400,
    note: 'evidence '.repeat(100),
  }
  const user = userEvent.setup()
  client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <LedgerTable
        entries={[{ source: 'customer', correction_id: 2, customer: row }]}
        postingAvailable
        onCorrect={vi.fn()}
      />
    </QueryClientProvider>
  )
  expect(
    screen.queryByRole('button', { name: 'Full refund' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Reverse entry' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('region', { name: 'Ledger entries' })
  ).toHaveAttribute('tabindex', '0')
  screen.getByRole('button', { name: '#1 · Manual receipt' }).focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('dialog', { name: 'Ledger entry #1' })
  expect(screen.getByText(row.payment_reference)).toBeVisible()
  expect(screen.getByText(row.note.trim())).toBeVisible()
})

function answer(requests: { url: string; body: unknown }[]): AxiosAdapter {
  return async (config) => {
    requests.push({
      url: config.url ?? '',
      body: config.data ? JSON.parse(config.data) : undefined,
    })
    let data: unknown = {}
    if (config.url === '/api/beacon/costs') {
      data = {
        now: 2000000000,
        sources: [
          {
            id: 3,
            name: 'novaris',
            type: 60,
            status: 1,
            base_url: 'https://upstream.example',
            observation: null,
            sync: null,
            rates: [
              {
                id: 1,
                channel_id: 3,
                effective_at: 1795000000,
                cny_per_unit: '1.25',
                operator_id: 1,
                recorded_at: 1795000000,
                note: '',
              },
            ],
          },
        ],
      }
    } else if (config.url === '/api/beacon/finance/payments') {
      data = { payment: { id: 11 }, created: true }
    } else if (config.url === '/api/beacon/finance/expenses') {
      data = { expense: { id: 5 }, created: true }
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
}

it('asks a receipt for no reason or exchange-rate source, and for a rate only in another currency', async () => {
  api.defaults.adapter = answer([])
  const user = userEvent.setup()
  setupDialog(vi.fn(), 'receipt')
  await screen.findByLabelText('Original currency amount')
  expect(screen.queryByLabelText('Reason / evidence')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Note (optional)')).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Exchange rate source')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('CNY per original currency unit')
  ).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Original currency'), 'USD')
  expect(screen.getByLabelText('CNY per original currency unit')).toHaveValue(
    ''
  )
})

it('records a server cost without a security proof', async () => {
  const requests: { url: string; body: unknown }[] = []
  api.defaults.adapter = answer(requests)
  const done = vi.fn()
  const user = userEvent.setup()
  setupDialog(done, 'receipt')
  await user.selectOptions(await screen.findByLabelText('Entry type'), 'server')
  expect(screen.queryByLabelText('Customer ID')).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Amount (CNY)'), '30')
  await user.type(screen.getByLabelText('Note (optional)'), ' November VPS ')
  await user.click(screen.getByRole('button', { name: 'Review entry' }))
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Confirm ledger entry',
  })
  expect(within(confirm).getByText(/Server cost/)).toBeInTheDocument()
  await user.click(
    within(confirm).getByRole('button', { name: 'Confirm and record' })
  )
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
  const posts = requests.filter((request) => request.body)
  expect(posts).toHaveLength(1)
  expect(posts[0].url).toBe('/api/beacon/finance/expenses')
  expect(posts[0].body).toMatchObject({
    category: 'server',
    amount: '30',
    corrects_id: 0,
    note: 'November VPS',
  })
  expect(requests.map((request) => request.url)).not.toContain(
    '/api/verify/methods'
  )
})

it('records a top-up to a preselected upstream with the credit filled in from its purchase price', async () => {
  const requests: { url: string; body: unknown }[] = []
  api.defaults.adapter = answer(requests)
  const done = vi.fn()
  const user = userEvent.setup()
  setupDialog(done, 'upstream', 3)
  await screen.findByRole('option', { name: 'novaris #3' })
  expect(screen.getByLabelText('Upstream')).toHaveValue('3')
  await user.type(screen.getByLabelText('CNY paid'), '100')
  expect(screen.getByLabelText('Credit received (upstream $)')).toHaveValue(
    '80'
  )
  await user.click(screen.getByRole('button', { name: 'Review entry' }))
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Confirm ledger entry',
  })
  expect(within(confirm).getByText(/novaris #3/)).toBeInTheDocument()
  await user.click(
    within(confirm).getByRole('button', { name: 'Confirm and record' })
  )
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
  const posts = requests.filter((request) => request.body)
  expect(posts).toHaveLength(1)
  expect(posts[0].url).toBe('/api/beacon/finance/payments')
  expect(posts[0].body).toMatchObject({
    channel_id: 3,
    amount: '100',
    credit: '80',
    corrects_id: 0,
    note: '',
  })
})

it('asks for an upstream before reviewing a top-up', async () => {
  const requests: { url: string; body: unknown }[] = []
  api.defaults.adapter = answer(requests)
  const user = userEvent.setup()
  setupDialog(vi.fn(), 'upstream')
  await screen.findByRole('option', { name: 'novaris #3' })
  await user.type(screen.getByLabelText('CNY paid'), '100')
  await user.type(screen.getByLabelText('Credit received (upstream $)'), '80')
  await user.click(screen.getByRole('button', { name: 'Review entry' }))
  expect(await screen.findByText('Choose an upstream.')).toBeInTheDocument()
  expect(screen.getByLabelText('Upstream')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(
    screen.queryByRole('alertdialog', { name: 'Confirm ledger entry' })
  ).not.toBeInTheDocument()
})

it('reverses an expense from the books without a security proof', async () => {
  const requests: { url: string; body: unknown }[] = []
  api.defaults.adapter = answer(requests)
  const entry: BookEntry = {
    source: 'expense',
    correction_id: null,
    expense: {
      id: 5,
      kind: 'expense',
      category: 'promotion',
      cny_amount_minor: 1250,
      corrects_id: null,
      occurred_at: 1795700000,
      operator_id: 1,
      recorded_at: 1795700000,
      note: '',
    },
  }
  const user = userEvent.setup()
  client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <LedgerTable entries={[entry]} postingAvailable onCorrect={vi.fn()} />
    </QueryClientProvider>
  )
  expect(
    screen.getByRole('button', { name: '#5 · Promotion cost' })
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Reverse entry' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(
    within(confirm).getByRole('button', { name: 'Reverse entry' })
  )
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0].url).toBe('/api/beacon/finance/expenses')
  expect(requests[0].body).toMatchObject({
    corrects_id: 5,
    category: '',
    amount: '',
  })
})
