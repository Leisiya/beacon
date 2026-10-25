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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { LedgerEntryDialog } from '../components/ledger-entry-dialog'
import { LedgerTable } from '../components/ledger-table'
import type { LedgerEntry } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
  useAuthStore.getState().auth.reset('idle')
})

function setupDialog(onComplete = vi.fn()): void {
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
        kind='gift'
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
  await user.type(screen.getByLabelText('Quota units to add'), '500')
  await user.type(
    screen.getByLabelText('Reason / evidence'),
    'service recovery gift'
  )
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
  expect(requests).toEqual(['/api/verify/methods'])
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
    correction_id: 2,
    occurred_at: 1767317400,
    recorded_at: 1767317400,
    note: 'evidence '.repeat(100),
  }
  const user = userEvent.setup()
  render(<LedgerTable entries={[row]} postingAvailable onCorrect={vi.fn()} />)
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
