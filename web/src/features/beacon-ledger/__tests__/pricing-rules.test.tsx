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
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { PricingRules } from '../components/pricing-rules'
import type { PricingReport, PricingRule } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
})

const rule: PricingRule = {
  id: 1,
  model_name: '',
  mode: 'cost_plus',
  markup_bp: 3000,
  min_markup_bp: 1500,
  auto_apply: false,
  follow_down: false,
  max_step_bp: 5000,
  updated_at: 0,
  operator_id: 1,
}

const basis = {
  channel_id: 3,
  channel_name: 'novaris',
  upstream_model: 'claude-sonnet-4-6',
  status: 'ok' as const,
  cny_per_unit: '1',
  upstream_group: 'ccmax',
  group_ratio: '2.4',
  source: 'expr',
  observed_at: 1795011821,
  verified_count: 4,
  mismatch_count: 0,
  min_markup_bp: 2500,
  lines: [
    {
      kind: 'input',
      context: 1000,
      cost_cny: 7.2,
      sale_cny: 9,
      markup_bp: 2500,
    },
    {
      kind: 'output',
      context: 1000,
      cost_cny: 36,
      sale_cny: 45,
      markup_bp: 2500,
    },
  ],
}

const report: PricingReport = {
  reference_cny_per_unit: 7.3,
  default_group_ratio: 1,
  default_rule: rule,
  overrides: [],
  models: [
    {
      model_name: 'claude-sonnet-4-6',
      status: 'ok',
      sale_expr: 'tier("base", p * 1.233)',
      rule,
      rule_overridden: false,
      channels: [basis],
      basis_channel_id: 3,
      current_markup_bp: 2500,
      below_minimum: false,
      factor: '1.04',
      proposed_expr: 'tier("base", p * 1.283)',
      sale: [
        {
          kind: 'input',
          context: 1000,
          cost_cny: 0,
          sale_cny: 9,
          markup_bp: null,
        },
        {
          kind: 'output',
          context: 1000,
          cost_cny: 0,
          sale_cny: 45,
          markup_bp: null,
        },
      ],
    },
  ],
  proposals: [
    {
      id: 9,
      model_name: 'claude-sonnet-4-6',
      status: 'pending',
      created_at: 1795011821,
      decided_at: 0,
      decider_id: 0,
      automatic: false,
      basis_channel_id: 3,
      factor: '1.04',
      current_markup_bp: 2500,
      target_markup_bp: 3000,
      old_expr: 'tier("base", p * 1.233)',
      new_expr: 'tier("base", p * 1.283)',
      detail: JSON.stringify({ basis }),
      error: '',
    },
  ],
  history: [],
}

function renderPricingRules(
  posts: { url: string; data: unknown }[],
  data: PricingReport = report
) {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    if (config.method === 'post') {
      posts.push({
        url: config.url ?? '',
        data: config.data ? JSON.parse(config.data) : null,
      })
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        success: true,
        data: config.method === 'get' ? data : null,
      },
    }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PricingRules />
    </QueryClientProvider>
  )
}

it('applies a suggested price only after confirming that every customer is affected', async () => {
  const posts: { url: string; data: unknown }[] = []
  renderPricingRules(posts)
  expect(await screen.findByText('Raise 4%')).toBeInTheDocument()
  expect(screen.getByText('¥7.2')).toBeInTheDocument()
  expect(screen.getByText('¥9.36')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Apply new price' }))
  expect(posts).toEqual([])
  expect(
    screen.getByText(/All customers, including prepaid balances/)
  ).toBeInTheDocument()
  const confirm = screen
    .getAllByRole('button', { name: 'Apply new price' })
    .at(-1)
  if (!confirm) throw new Error('missing confirm button')
  await userEvent.click(confirm)
  await waitFor(() =>
    expect(posts.map((post) => post.url)).toEqual([
      '/api/beacon/pricing/proposals/9/apply',
    ])
  )
})

it('shows each model’s CNY sale and cost prices next to its markup', async () => {
  renderPricingRules([])
  expect(await screen.findByText('¥9 / ¥45')).toBeInTheDocument()
  expect(screen.getByText('¥7.2 / ¥36')).toBeInTheDocument()
  expect(screen.getByText('#3 novaris · ×2.4')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Edit sale price' })
  ).toBeInTheDocument()
})

it('names enabled channels left out of the markup because they have no cost yet', async () => {
  const unobserved = {
    ...basis,
    channel_id: 2,
    channel_name: 'NOVARIS',
    status: 'no_observation' as const,
    group_ratio: '',
    min_markup_bp: null,
    lines: [],
  }
  renderPricingRules([], {
    ...report,
    models: [{ ...report.models[0], channels: [basis, unobserved] }],
  })
  expect(
    await screen.findByText('Not counted, no cost yet: #2 NOVARIS')
  ).toBeInTheDocument()
})

it('tells the operator the sale price editor takes prices before the group ratio', async () => {
  renderPricingRules([], { ...report, default_group_ratio: 3.6 })
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit sale price' })
  )
  expect(
    await screen.findByText(
      'These are prices before the group ratio: customers pay them × 3.6. To charge ¥5 per 1M, enter 1.3889.'
    )
  ).toBeInTheDocument()
})

it('hides the group ratio note when customers pay the entered price', async () => {
  renderPricingRules([])
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit sale price' })
  )
  await screen.findByRole('dialog')
  expect(
    screen.queryByText(/These are prices before the group ratio/)
  ).not.toBeInTheDocument()
})

it('hides the pending changes card when nothing awaits confirmation', async () => {
  renderPricingRules([], { ...report, proposals: [] })
  expect(await screen.findByText('¥9 / ¥45')).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', {
      name: 'Price changes awaiting confirmation',
    })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Price change pending')).not.toBeInTheDocument()
})

it('saves a new top-up price only when it is a positive number', async () => {
  const posts: { url: string; data: unknown }[] = []
  renderPricingRules(posts)
  const user = userEvent.setup()
  expect(await screen.findByText('¥7.3 = $1 of balance')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Change top-up price' }))
  const input = screen.getByLabelText('CNY for $1 of balance')
  await user.clear(input)
  await user.type(input, '0')
  await user.click(screen.getByRole('button', { name: 'Save top-up price' }))
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(posts).toEqual([])
  await user.clear(input)
  await user.type(input, '3.65')
  await user.click(screen.getByRole('button', { name: 'Save top-up price' }))
  await waitFor(() =>
    expect(posts).toEqual([
      {
        url: '/api/beacon/pricing/reference',
        data: { cny_per_unit: '3.65' },
      },
    ])
  )
})
