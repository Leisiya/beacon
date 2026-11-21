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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getProfitSummary } from '../api'
import type { CashRangeValues } from '../lib/cash-range'
import { addMicro, formatMicroCny } from '../lib/cost'
import type { CostGroupBy, ProfitRow } from '../types'
import { RangeForm } from './range-form'
import { SummaryMetrics } from './summary-metrics'

// Profit covers only requests whose upstream deduction is synced and priced;
// deductions with no local request are subtracted as a cost.
export function ProfitSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [range, setRange] = useState<CashRangeValues>({
    period: 'month',
    start: '',
    end: '',
  })
  const [groupBy, setGroupBy] = useState<CostGroupBy>('model')
  const [draftGroupBy, setDraftGroupBy] = useState<CostGroupBy>('model')
  const summary = useQuery({
    queryKey: ['beacon-ledger', 'profit-summary', range, groupBy],
    queryFn: () => getProfitSummary(range, groupBy),
    retry: false,
    staleTime: 0,
  })
  const data = summary.data
  const cny = (micro: string) => formatMicroCny(micro, 4)
  const cost = (row: ProfitRow) =>
    addMicro(row.cost_micro_cny, row.unmatched_cost_micro_cny)
  const margin = (row: ProfitRow) => {
    const costed = Number(row.costed_micro_cny)
    if (!(costed > 0)) return '—'
    const percent = (Number(row.profit_micro_cny) / costed) * 100
    return `${Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent)}%`
  }
  const profit = (row: ProfitRow) => (
    <span
      className={cn(
        'tabular-nums',
        BigInt(row.profit_micro_cny) < 0n && 'text-destructive'
      )}
    >
      {cny(row.profit_micro_cny)}
    </span>
  )
  const groupLabels: Record<CostGroupBy, string> = {
    model: t('Model'),
    user: t('Customer'),
    channel: t('Channel'),
    day: t('Date (Shanghai)'),
  }
  const rowLabel = (row: ProfitRow) => {
    if (data?.group_by === 'user' && row.key === '0') {
      return t('No request on this site')
    }
    return row.label || '—'
  }
  return (
    <TitledCard
      title={<h2>{t('Profit')}</h2>}
      description={t(
        'Customer usage against supplier cost · CNY · Asia/Shanghai'
      )}
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-5'>
        <RangeForm
          idPrefix='profit'
          initial={range}
          fetching={summary.isFetching}
          refreshLabel={t('Refresh summary')}
          onApply={(values) => {
            setRange(values)
            setGroupBy(draftGroupBy)
          }}
          onRefresh={() => {
            void summary.refetch()
          }}
        >
          <Field className='w-full sm:w-44'>
            <FieldLabel htmlFor='profit-group-by'>{t('Group by')}</FieldLabel>
            <NativeSelect
              id='profit-group-by'
              className='w-full [&_select]:min-h-11'
              value={draftGroupBy}
              onChange={(event) =>
                setDraftGroupBy(event.target.value as CostGroupBy)
              }
            >
              {(Object.keys(groupLabels) as CostGroupBy[]).map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {groupLabels[key]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </RangeForm>
        {summary.isPending && <LoadingState />}
        {summary.isError && (
          <ErrorState
            onRetry={() => {
              void summary.refetch()
            }}
          />
        )}
        {summary.isSuccess && data && (
          <div
            className='flex min-w-0 flex-col gap-4'
            aria-live='polite'
            aria-busy={summary.isFetching}
          >
            <p className='text-muted-foreground text-sm'>
              {t('Included occurrence dates')}: {data.range.start_date} —{' '}
              {data.range.end_date}
            </p>
            <SummaryMetrics
              metrics={[
                {
                  label: t('Customer usage (CNY)'),
                  value: cny(data.total.usage_micro_cny),
                },
                {
                  label: t('Upstream cost (CNY)'),
                  value: cny(cost(data.total)),
                },
                {
                  label: t('Estimated gross profit'),
                  value: cny(data.total.profit_micro_cny),
                },
                { label: t('Gross margin'), value: margin(data.total) },
              ]}
            />
            {data.total.requests > data.total.costed_requests && (
              <p className='text-sm'>
                {t(
                  '{{count}} requests have no upstream cost yet and are left out of the profit: the channel has no purchase price, the upstream is not built on New API, or the next sync has not run.',
                  { count: data.total.requests - data.total.costed_requests }
                )}
              </p>
            )}
            {data.total.unmatched_requests > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} upstream deductions ({{amount}}) have no matching request on this site and are subtracted from the profit: failed or retried requests, or other keys on the same upstream account.',
                  {
                    count: data.total.unmatched_requests,
                    amount: cny(data.total.unmatched_cost_micro_cny),
                  }
                )}
              </p>
            )}
            {data.total.pending_requests > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} upstream deductions have no purchase price for their time, so their cost is unknown and left out. Set a purchase price that covers them.',
                  { count: data.total.pending_requests }
                )}
              </p>
            )}
            <StaticDataTable
              className='overflow-x-auto'
              tableProps={{ withContainer: false }}
              data={data.rows}
              getRowKey={(row) => row.key}
              containerProps={{
                role: 'region',
                'aria-label': t('Profit'),
                tabIndex: 0,
              }}
              tableClassName='min-w-[680px]'
              columns={[
                {
                  id: 'label',
                  header: groupLabels[data.group_by],
                  cell: (row) => (
                    <span className='break-all'>{rowLabel(row)}</span>
                  ),
                },
                {
                  id: 'requests',
                  header: t('Requests with cost / all'),
                  cell: (row) =>
                    `${formatNumber(row.costed_requests, locale)} / ${formatNumber(row.requests, locale)}`,
                },
                {
                  id: 'usage',
                  header: t('Customer usage'),
                  cell: (row) => cny(row.usage_micro_cny),
                },
                {
                  id: 'cost',
                  header: t('Upstream cost'),
                  cell: (row) => cny(cost(row)),
                },
                { id: 'profit', header: t('Gross profit'), cell: profit },
                { id: 'margin', header: t('Gross margin'), cell: margin },
              ]}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Customer usage is balance deducted from customers, valued at the top-up price of ¥{{price}} per $1. It is not revenue: gifts and receipt discounts are not separated yet. Profit counts only requests with a known upstream cost; each cost uses the purchase price in effect when the request happened.',
                { price: data.reference_cny_per_unit }
              )}
            </p>
          </div>
        )}
      </div>
    </TitledCard>
  )
}
