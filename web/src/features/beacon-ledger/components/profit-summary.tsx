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
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getProfitSummary } from '../api'
import type { CashRangeValues } from '../lib/cash-range'
import { formatCny } from '../lib/cost'
import type { ProfitGroupBy, ProfitRow } from '../types'
import { RangeForm } from './range-form'
import { SummaryMetrics } from './summary-metrics'

export function ProfitSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [range, setRange] = useState<CashRangeValues>({
    period: 'month',
    start: '',
    end: '',
  })
  const [groupBy, setGroupBy] = useState<ProfitGroupBy>('day')
  const [draftGroupBy, setDraftGroupBy] = useState<ProfitGroupBy>('day')
  const summary = useQuery({
    queryKey: ['beacon-ledger', 'profit-summary', range, groupBy],
    queryFn: () => getProfitSummary(range, groupBy),
    retry: false,
    staleTime: 0,
  })
  const data = summary.data
  const margin = (row: ProfitRow) => {
    const revenue = Number(row.revenue_micro_cny)
    if (!(revenue > 0)) return '—'
    const percent = (Number(row.profit_micro_cny) / revenue) * 100
    return `${Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent)}%`
  }
  const profit = (row: ProfitRow) => (
    <span
      className={cn(
        'tabular-nums',
        BigInt(row.profit_micro_cny) < 0n && 'text-destructive'
      )}
    >
      {formatCny(row.profit_micro_cny)}
    </span>
  )
  const groupLabels: Record<ProfitGroupBy, string> = {
    day: t('Date (Shanghai)'),
    user: t('Customer'),
    model: t('Model'),
    channel: t('Channel'),
  }
  const rowLabel = (row: ProfitRow) => {
    if (data?.group_by === 'user' && row.key === '0') {
      return t('No request on this site')
    }
    if (row.key === 'adjustment' && data?.group_by !== 'user') {
      return t('Refund adjustments')
    }
    if (row.key === 'expenses' && data?.group_by !== 'day') {
      return t('Other costs')
    }
    return row.label || '—'
  }
  return (
    <TitledCard
      title={<h2>{t('Profit')}</h2>}
      description={t(
        'What customers used against what upstreams charged and other costs · CNY'
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
                setDraftGroupBy(event.target.value as ProfitGroupBy)
              }
            >
              {(Object.keys(groupLabels) as ProfitGroupBy[]).map((key) => (
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
                  label: t('Used by customers'),
                  value: formatCny(data.total.revenue_micro_cny),
                },
                {
                  label: t('Charged by upstreams'),
                  value: formatCny(data.total.cost_micro_cny),
                },
                {
                  label: t('Other costs'),
                  value: formatCny(data.total.expense_micro_cny),
                },
                {
                  label: t('Profit'),
                  value: formatCny(data.total.profit_micro_cny),
                },
                { label: t('Profit margin'), value: margin(data.total) },
              ]}
            />
            {BigInt(data.gift_quota) > 0n && (
              <p className='text-sm'>
                {t(
                  '{{amount}} of gifted balance was used. Gifts earn nothing.',
                  { amount: formatQuota(Number(data.gift_quota)) }
                )}
              </p>
            )}
            {BigInt(data.unpaid_quota) > 0n && (
              <p className='text-sm'>
                {t(
                  '{{amount}} was used with no recorded payment behind it, such as test accounts or balance added outside the ledger. It earns nothing.',
                  { amount: formatQuota(Number(data.unpaid_quota)) }
                )}
              </p>
            )}
            {data.pending_charges > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} upstream deductions have no purchase price yet, so their cost is missing. Set it under Purchase and sale prices.',
                  { count: data.pending_charges }
                )}
              </p>
            )}
            {data.uncosted_requests > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} requests went through channels with no purchase price, so their cost is missing and the profit is too high.',
                  { count: data.uncosted_requests }
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
              tableClassName='min-w-[760px]'
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
                  header: t('Requests'),
                  cell: (row) => formatNumber(row.requests, locale),
                },
                {
                  id: 'revenue',
                  header: t('Used by customers'),
                  cell: (row) => formatCny(row.revenue_micro_cny),
                },
                {
                  id: 'cost',
                  header: t('Charged by upstreams'),
                  cell: (row) => formatCny(row.cost_micro_cny),
                },
                {
                  id: 'expense',
                  header: t('Other costs'),
                  cell: (row) => formatCny(row.expense_micro_cny),
                },
                { id: 'profit', header: t('Profit'), cell: profit },
                { id: 'margin', header: t('Profit margin'), cell: margin },
              ]}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Profit = what customers used − what upstreams charged for it − other costs. Customer usage is valued at what each customer actually paid; gifted balance is used first and is worth nothing. Upstream charges use the purchase price in effect at the time. Other costs count on the day they were paid; grouped by customer, model or channel they are one separate row.'
              )}
            </p>
          </div>
        )}
      </div>
    </TitledCard>
  )
}
