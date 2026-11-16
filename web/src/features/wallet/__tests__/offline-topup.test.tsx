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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Wallet } from '..'
import { OfflineTopupCard } from '../components/offline-topup-card'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const offlineTopupInfo = {
  enable_online_topup: false,
  enable_stripe_topup: false,
  enable_creem_topup: false,
  enable_waffo_topup: false,
  enable_waffo_pancake_topup: false,
  pay_methods: [],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [],
  discount: {},
  topup_link: 'https://contact.example/beacon',
  enable_redemption: true,
  payment_compliance_confirmed: true,
}

function renderWallet(topupInfo: Record<string, unknown>) {
  const requested: string[] = []
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    requested.push(url)
    if (url === '/api/user/topup/info') {
      return { data: { success: true, data: topupInfo } }
    }
    if (url === '/api/user/self') {
      return {
        data: {
          success: true,
          data: { id: 7, quota: 0, used_quota: 0, request_count: 0 },
        },
      }
    }
    return { data: { success: true, data: [] } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Wallet />
    </QueryClientProvider>
  )
  return requested
}

it('links customers to the configured administrator contact when payment is offline', () => {
  render(<OfflineTopupCard contactLink='https://contact.example/beacon' />)

  const contact = screen.getByRole('link', {
    name: 'Contact the administrator',
  })

  expect(contact).toHaveAttribute('href', 'https://contact.example/beacon')
  expect(contact).toHaveAttribute('target', '_blank')
  expect(contact).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
})

it('asks customers to contact their administrator when no contact link is configured', () => {
  render(<OfflineTopupCard />)

  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(
    screen.getByText(
      'Contact the administrator who opened your account to top up.'
    )
  ).toBeInTheDocument()
})

it('shows offline payment steps without redemption codes or referral rewards when online payment is off', async () => {
  const requested = renderWallet(offlineTopupInfo)

  expect(
    await screen.findByRole('link', { name: 'Contact the administrator' })
  ).toBeInTheDocument()
  expect(
    screen.queryByLabelText('Have a Code?')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Online topup is not enabled/)
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Referral Program')).not.toBeInTheDocument()
  expect(requested).not.toContain('/api/user/aff')
})

it('keeps the online payment form when an online payment method is enabled', async () => {
  renderWallet({ ...offlineTopupInfo, enable_online_topup: true })

  await waitFor(() =>
    expect(
      screen.getByText('Choose an amount and payment method')
    ).toBeInTheDocument()
  )
  expect(
    screen.queryByRole('link', { name: 'Contact the administrator' })
  ).not.toBeInTheDocument()
})
