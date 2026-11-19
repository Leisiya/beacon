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

import { getCostSummary } from '../api'
import type { CashRangeValues } from '../lib/cash-range'
import { formatMicro, quotaToMicro } from '../lib/cost'
import type { CostGroupBy, CostRow } from '../types'
import { RangeForm } from './range-form'
import { SummaryMetrics } from './summary-metrics'

export function UpstreamCostSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [range, setRange] = useState<CashRangeValues>({
    period: 'today',
    start: '',
    end: '',
  })
  const [groupBy, setGroupBy] = useState<CostGroupBy>('channel')
  const [draftGroupBy, setDraftGroupBy] = useState<CostGroupBy>('channel')
  const summary = useQuery({
    queryKey: ['beacon-ledger', 'cost-summary', range, groupBy],
    queryFn: () => getCostSummary(range, groupBy),
    retry: false,
    staleTime: 0,
  })
  const data = summary.data
  const cny = (row: CostRow) => `¥${formatMicro(row.cost_micro_cny, 4)}`
  const listPrice = (row: CostRow) =>
    `$${formatMicro(quotaToMicro(row.local_quota, data?.quota_per_unit ?? 0), 4)}`
  const groupLabels: Record<CostGroupBy, string> = {
    channel: t('Channel'),
    model: t('Model'),
    day: t('Date (Shanghai)'),
    user: t('Customer'),
  }
  return (
    <TitledCard
      title={<h2>{t('Upstream cost summary')}</h2>}
      description={t('Actual supplier deductions · CNY · Asia/Shanghai')}
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-5'>
        <RangeForm
          idPrefix='cost'
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
            <FieldLabel htmlFor='cost-group-by'>{t('Group by')}</FieldLabel>
            <NativeSelect
              id='cost-group-by'
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
                { label: t('Upstream cost (CNY)'), value: cny(data.total) },
                {
                  label: t('Upstream credit deducted'),
                  value: formatMicro(data.total.credit_micro, 4),
                },
                {
                  label: t('Customer charges at list price'),
                  value: listPrice(data.total),
                },
                {
                  label: t('Upstream requests'),
                  value: formatNumber(data.total.calls, locale),
                },
              ]}
            />
            {data.total.pending_calls > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} requests have no CNY rate yet and are not included in the CNY cost. Add a rate that covers their time.',
                  { count: data.total.pending_calls }
                )}
              </p>
            )}
            {data.total.unmatched_calls > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} upstream deductions have no matching request in this site’s logs: failed or retried requests, other keys on the same upstream account, or logs that were cleaned up.',
                  { count: data.total.unmatched_calls }
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
                'aria-label': t('Upstream cost summary'),
                tabIndex: 0,
              }}
              tableClassName='min-w-[680px]'
              columns={[
                {
                  id: 'label',
                  header: groupLabels[data.group_by],
                  cell: (row) => row.label || '—',
                },
                {
                  id: 'calls',
                  header: t('Requests'),
                  cell: (row) => formatNumber(row.calls, locale),
                },
                {
                  id: 'credit',
                  header: t('Upstream credit'),
                  cell: (row) => formatMicro(row.credit_micro, 4),
                },
                { id: 'cost', header: t('Cost (CNY)'), cell: cny },
                {
                  id: 'list',
                  header: t('Customer charges at list price'),
                  cell: listPrice,
                },
                {
                  id: 'flags',
                  header: t('Pending / unmatched'),
                  cell: (row) =>
                    `${formatNumber(row.pending_calls, locale)} / ${formatNumber(row.unmatched_calls, locale)}`,
                },
              ]}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Costs use the rate in effect when each request happened and are not recalculated when a rate changes. Customer charges at list price are quota deducted from customers, not revenue: gifts and receipt discounts are not separated yet.'
              )}
            </p>
          </div>
        )}
      </div>
    </TitledCard>
  )
}
