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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { updateChannelBalance } from '@/features/channels/api'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { getUpstreamFinance } from '../api'
import type { CashRangeValues } from '../lib/cash-range'
import { formatCny, formatCredit } from '../lib/cost'
import type { UpstreamFinanceRow } from '../types'
import { RangeForm } from './range-form'
import { SummaryMetrics } from './summary-metrics'

// A top-up is recorded through New entry, preset to this upstream.
export function UpstreamFinance(props: {
  onTopUp: (channelId: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [range, setRange] = useState<CashRangeValues>({
    period: 'all',
    start: '',
    end: '',
  })
  const report = useQuery({
    queryKey: ['beacon-ledger', 'upstream-finance', range],
    queryFn: () => getUpstreamFinance(range),
    retry: false,
    staleTime: 0,
  })
  const refreshBalance = useMutation({
    mutationFn: (channelId: number) => updateChannelBalance(channelId),
    onSuccess: (response) => {
      if (response.success && response.balance !== undefined) {
        toast.success(
          t('Balance updated: {{balance}}', {
            balance: formatCredit(Math.round(response.balance * 1_000_000)),
          })
        )
        void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
        return
      }
      handleServerError(response, t('Failed to update balance'))
    },
    onError: (error) => handleServerError(error, t('Failed to update balance')),
  })
  const data = report.data
  const remaining = (row: UpstreamFinanceRow) => (
    <span
      className={cn(
        'flex flex-col tabular-nums',
        row.remaining_micro_cny.startsWith('-') && 'text-destructive'
      )}
    >
      <span>{formatCny(row.remaining_micro_cny)}</span>
      <span className='text-muted-foreground'>
        {formatCredit(row.remaining_credit_micro)}
      </span>
    </span>
  )
  const reported = (row: UpstreamFinanceRow) => (
    <span className='flex flex-col items-start gap-1'>
      <span className='tabular-nums'>
        {row.reported_at > 0
          ? formatCredit(Math.round(row.reported_balance * 1_000_000))
          : '—'}
      </span>
      {row.reported_at > 0 && (
        <span className='text-muted-foreground text-xs'>
          {new Date(row.reported_at * 1000).toLocaleString(locale, {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })}
        </span>
      )}
      <Button
        className='h-auto min-h-11 p-0 sm:min-h-0'
        variant='link'
        disabled={refreshBalance.isPending}
        aria-label={t('Check the balance of {{name}}', { name: row.name })}
        onClick={() => refreshBalance.mutate(row.channel_id)}
      >
        {t('Check now')}
      </Button>
    </span>
  )
  return (
    <TitledCard
      title={<h2>{t('Upstreams')}</h2>}
      description={t('What was paid to each upstream, used and left · CNY')}
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-5'>
        <RangeForm
          idPrefix='upstreams'
          initial={range}
          fetching={report.isFetching}
          refreshLabel={t('Refresh summary')}
          onApply={setRange}
          onRefresh={() => {
            void report.refetch()
          }}
        />
        {report.isPending && <LoadingState />}
        {report.isError && (
          <ErrorState
            onRetry={() => {
              void report.refetch()
            }}
          />
        )}
        {report.isSuccess && data && (
          <div
            className='flex min-w-0 flex-col gap-4'
            aria-live='polite'
            aria-busy={report.isFetching}
          >
            <p className='text-muted-foreground text-sm'>
              {t('Included occurrence dates')}: {data.range.start_date} —{' '}
              {data.range.end_date}
            </p>
            <SummaryMetrics
              metrics={[
                {
                  label: t('Paid in this period'),
                  value: formatCny(data.total.paid_micro_cny),
                },
                {
                  label: t('Used in this period'),
                  value: formatCny(data.total.used_micro_cny),
                },
                {
                  label: t('Remaining now'),
                  value: formatCny(data.total.remaining_micro_cny),
                },
              ]}
            />
            {data.rows.length === 0 ? (
              <EmptyState
                title={t('No upstreams yet')}
                description={t(
                  'An upstream appears here once it has a purchase price or a payment.'
                )}
              />
            ) : (
              <StaticDataTable
                className='overflow-x-auto'
                tableProps={{ withContainer: false }}
                data={data.rows}
                getRowKey={(row) => String(row.channel_id)}
                containerProps={{
                  role: 'region',
                  'aria-label': t('Upstreams'),
                  tabIndex: 0,
                }}
                tableClassName='min-w-[760px]'
                columns={[
                  {
                    id: 'name',
                    header: t('Upstream'),
                    cell: (row) => (
                      <span className='break-all'>
                        {row.name || '—'}{' '}
                        <span className='text-muted-foreground'>
                          #{row.channel_id}
                        </span>
                      </span>
                    ),
                  },
                  {
                    id: 'paid',
                    header: t('Paid'),
                    cell: (row) => formatCny(row.paid_micro_cny),
                  },
                  {
                    id: 'used',
                    header: t('Used'),
                    cell: (row) => formatCny(row.used_micro_cny),
                  },
                  {
                    id: 'remaining',
                    header: t('Remaining now'),
                    cell: remaining,
                  },
                  {
                    id: 'reported',
                    header: t('Balance shown by the upstream'),
                    cell: reported,
                  },
                  {
                    id: 'actions',
                    header: t('Actions'),
                    cell: (row) => (
                      <Button
                        className='min-h-11'
                        variant='outline'
                        aria-label={t('Record a top-up to {{name}}', {
                          name: row.name,
                        })}
                        onClick={() => props.onTopUp(row.channel_id)}
                      >
                        {t('Record top-up')}
                      </Button>
                    ),
                  },
                ]}
              />
            )}
            {data.total.pending_charges > 0 && (
              <p className='text-sm'>
                {t(
                  '{{count}} upstream deductions have no purchase price yet, so their cost is missing. Set it under Purchase and sale prices.',
                  { count: data.total.pending_charges }
                )}
              </p>
            )}
            <p className='text-muted-foreground text-sm'>
              {t(
                'Paid = money you sent to the upstream. Used = what it deducted for requests, at your purchase price. Remaining = everything paid − everything used. Compare the remaining credit with the balance the upstream shows; a gap means a payment or usage is missing. Record earlier payments once so the remaining amount starts right.'
              )}
            </p>
          </div>
        )}
      </div>
    </TitledCard>
  )
}
