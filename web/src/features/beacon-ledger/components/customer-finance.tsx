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
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { formatQuota } from '@/lib/format'

import { getCustomerFinance } from '../api'
import type { CashRangeValues } from '../lib/cash-range'
import { formatCny } from '../lib/cost'
import { RangeForm } from './range-form'
import { SummaryMetrics } from './summary-metrics'

// A refund is recorded through New entry, preset to this customer and to what
// they paid for but have not used.
export function CustomerFinance(props: {
  onRefund: (userId: number, amount: string) => void
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<CashRangeValues>({
    period: 'all',
    start: '',
    end: '',
  })
  const report = useQuery({
    queryKey: ['beacon-ledger', 'customer-finance', range],
    queryFn: () => getCustomerFinance(range),
    retry: false,
    staleTime: 0,
  })
  const data = report.data
  return (
    <TitledCard
      title={<h2>{t('Customers')}</h2>}
      description={t('What each customer paid, used and has left · CNY')}
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-5'>
        <RangeForm
          idPrefix='customers'
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
                title={t('No customer activity yet')}
                description={t(
                  'Customers appear here after their first receipt or request.'
                )}
              />
            ) : (
              <StaticDataTable
                className='overflow-x-auto'
                tableProps={{ withContainer: false }}
                data={data.rows}
                getRowKey={(row) => String(row.user_id)}
                containerProps={{
                  role: 'region',
                  'aria-label': t('Customers'),
                  tabIndex: 0,
                }}
                tableClassName='min-w-[760px]'
                columns={[
                  {
                    id: 'customer',
                    header: t('Customer'),
                    cell: (row) => (
                      <span className='break-all'>
                        {row.username || '—'}{' '}
                        <span className='text-muted-foreground'>
                          #{row.user_id}
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
                    cell: (row) => formatCny(row.remaining_micro_cny),
                  },
                  {
                    id: 'balance',
                    header: t('Wallet balance'),
                    cell: (row) => formatQuota(Number(row.balance_quota)),
                  },
                  {
                    id: 'actions',
                    header: t('Actions'),
                    cell: (row) => {
                      // Whole cents of the unused paid value, rounded down.
                      const cents = BigInt(row.remaining_micro_cny) / 10000n
                      const unused =
                        cents > 0n
                          ? `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
                          : ''
                      return (
                        <Button
                          className='min-h-11'
                          variant='outline'
                          aria-label={t('Record a refund to {{name}}', {
                            name: row.username || `#${row.user_id}`,
                          })}
                          onClick={() => props.onRefund(row.user_id, unused)}
                        >
                          {t('Refund')}
                        </Button>
                      )
                    },
                  },
                ]}
              />
            )}
            {BigInt(data.total.unpaid_quota) > 0n && (
              <p className='text-sm'>
                {t(
                  '{{amount}} was used with no recorded payment behind it, such as test accounts or balance added outside the ledger. It earns nothing.',
                  { amount: formatQuota(Number(data.total.unpaid_quota)) }
                )}
              </p>
            )}
            <p className='text-muted-foreground text-sm'>
              {t(
                'Paid = receipts − refunds. Used = balance used up, valued at what that customer paid; gifted balance is used first and is worth nothing. Remaining = paid for but not used yet. Wallet balance is what the customer sees now, gifts included.'
              )}
            </p>
          </div>
        )}
      </div>
    </TitledCard>
  )
}
