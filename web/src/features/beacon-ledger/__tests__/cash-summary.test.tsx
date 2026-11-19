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
import { AxiosError } from 'axios'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { CashSummary } from '../components/cash-summary'
import { cashRangeSchema } from '../lib/cash-range'
import { formatMicro, fromShanghaiInput, quotaToMicro } from '../lib/cost'
import { ledgerMoney } from '../lib/form'
import type { CashSummaryData } from '../types'

const originalAdapter = api.defaults.adapter
let client: QueryClient
afterEach(() => {
  api.defaults.adapter = originalAdapter
  client?.clear()
  vi.restoreAllMocks()
})

const summary: CashSummaryData = {
  range: {
    period: 'today',
    start_date: '2026-01-03',
    end_date: '2026-01-03',
    start_at: 1767369600,
    end_before: 1767412801,
    as_of: 1767412800,
  },
  base_currency: 'CNY',
  business_timezone: 'Asia/Shanghai',
  receipt_minor: '14318',
  refund_minor: '7236',
  reversal_minor: '-7159',
  net_minor: '-77',
  entry_count: 5,
  gift_count: 1,
  receipt_quota: '1000',
  gift_quota: '20',
  correction_quota: '-1000',
  usage_quota: '9007199254740993',
}

function renderSummary() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CashSummary />
    </QueryClientProvider>
  )
}

it('shows exact recorded cash and quota movement with its coverage and keeps missing profit data explicitly pending', async () => {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: summary },
  })
  renderSummary()
  expect(await screen.findByText('CNY -0.77')).toBeInTheDocument()
  expect(screen.getByText('CNY 143.18')).toBeInTheDocument()
  expect(screen.getByText('CNY 72.36')).toBeInTheDocument()
  expect(screen.getByText('CNY -71.59')).toBeInTheDocument()
  expect(screen.getByText('1,000')).toBeInTheDocument()
  expect(screen.getByText('-1,000')).toBeInTheDocument()
  expect(screen.getByText('9,007,199,254,740,993')).toBeInTheDocument()
  expect(
    screen.getByText(/Usage revenue, unspent purchased balance/)
  ).toHaveTextContent('pending')
  expect(screen.getByText(/Only this manual ledger/)).toBeInTheDocument()
})

it('validates custom dates before requesting a report and applies the chosen occurrence range', async () => {
  const requests: Record<string, string>[] = []
  api.defaults.adapter = async (config) => {
    requests.push(config.params)
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data: summary },
    }
  }
  const user = userEvent.setup()
  renderSummary()
  await screen.findByText('CNY -0.77')
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
  await screen.findByText('CNY -0.77')
  expect(requests.at(-1)).toMatchObject({
    view: 'cash_summary',
    period: 'custom',
    start: '2026-01-03',
    end: '2026-01-04',
  })
})

it('does not render zero totals on failure and reports empty coverage only after a successful retry', async () => {
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
      data: {
        success: true,
        data: {
          ...summary,
          receipt_minor: '0',
          refund_minor: '0',
          reversal_minor: '0',
          net_minor: '0',
          entry_count: 0,
          gift_count: 0,
        },
      },
    }
  }
  const user = userEvent.setup()
  renderSummary()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(screen.queryByText('CNY 0.00')).not.toBeInTheDocument()
  await user.click(retry)
  await screen.findByText(
    'No recorded entries in this period. These zeros do not represent a complete business balance.'
  )
  expect(screen.getAllByText('CNY 0.00')).toHaveLength(4)
})

it('uses Shanghai dates at UTC month boundaries and preserves cents beyond int64', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-31T16:00:00Z'))
  expect(
    cashRangeSchema.safeParse({
      period: 'custom',
      start: '2026-02-01',
      end: '2026-02-01',
    }).success
  ).toBe(true)
  expect(
    cashRangeSchema.safeParse({
      period: 'custom',
      start: '2026-02-01',
      end: '2026-02-02',
    }).success
  ).toBe(false)
  expect(
    cashRangeSchema.safeParse({
      period: 'custom',
      start: '2025-02-29',
      end: '2025-03-01',
    }).success
  ).toBe(false)
  expect(ledgerMoney('9232379236109515775', 'CNY')).toBe(
    'CNY 92323792361095157.75'
  )
})

it('formats upstream cost millionths exactly and converts Shanghai times', () => {
  expect(formatMicro('23936', 4)).toBe('0.0239')
  expect(formatMicro('23950', 4)).toBe('0.0240')
  expect(formatMicro('-1500000', 2)).toBe('-1.50')
  expect(formatMicro('9232379236109515775', 2)).toBe('9232379236109.52')
  expect(quotaToMicro('6650', 500000)).toBe('13300')
  expect(quotaToMicro('6650', 0)).toBe('0')
  expect(fromShanghaiInput('2026-11-18T00:00')).toBe(1794931200)
})
