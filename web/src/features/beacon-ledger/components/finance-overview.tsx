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
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { getFinanceOverview } from '../api'
import { formatCny } from '../lib/cost'
import type { FinanceTab } from '../types'

function HeadlineCard(props: {
  title: string
  label: string
  value: string
  lines: { label: string; value: string }[]
  action: string
  onAction: () => void
}) {
  return (
    <Card data-card-hover='false' className='min-w-0'>
      <CardHeader>
        <CardTitle>
          <h2>{props.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <div>
          <p className='text-muted-foreground text-sm'>{props.label}</p>
          <p
            className={cn(
              'text-3xl font-semibold break-all tabular-nums',
              props.value.startsWith('-') && 'text-destructive'
            )}
          >
            {props.value}
          </p>
        </div>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
          {props.lines.map((line) => (
            <div key={line.label} className='contents'>
              <dt className='text-muted-foreground'>{line.label}</dt>
              <dd
                className={cn(
                  'text-end break-all tabular-nums',
                  line.value.startsWith('-') && 'text-destructive'
                )}
              >
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardFooter className='mt-auto'>
        <Button
          className='min-h-11 w-full'
          variant='outline'
          onClick={props.onAction}
        >
          {props.action}
        </Button>
      </CardFooter>
    </Card>
  )
}

// The numbers to check every day: profit, what customers paid, what was paid
// to upstreams and other costs. Each card opens its detail tab.
export function FinanceOverview(props: { onOpen: (tab: FinanceTab) => void }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const overview = useQuery({
    queryKey: ['beacon-ledger', 'finance-overview'],
    queryFn: getFinanceOverview,
    retry: false,
    // Refresh on navigation/focus; do not silently retain yesterday's "today".
    staleTime: 0,
  })
  if (overview.isPending) return <LoadingState />
  if (overview.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void overview.refetch()
        }}
      />
    )
  }
  const data = overview.data
  return (
    <div
      className='flex min-w-0 flex-col gap-4'
      aria-live='polite'
      aria-busy={overview.isFetching}
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>
          {t('As of {{time}} (Asia/Shanghai)', {
            time: new Date(data.as_of * 1000).toLocaleString(locale, {
              timeZone: 'Asia/Shanghai',
              hour12: false,
            }),
          })}
        </p>
        <Button
          className='min-h-11'
          variant='outline'
          disabled={overview.isFetching}
          onClick={() => {
            void overview.refetch()
          }}
        >
          {t('Refresh')}
        </Button>
      </div>
      <div className='grid min-w-0 gap-4 md:grid-cols-2 2xl:grid-cols-4'>
        <HeadlineCard
          title={t('Profit')}
          label={t('Today')}
          value={formatCny(data.today.profit_micro_cny)}
          lines={[
            {
              label: t('Month to date'),
              value: formatCny(data.month.profit_micro_cny),
            },
            {
              label: t('All time'),
              value: formatCny(data.all.profit_micro_cny),
            },
          ]}
          action={t('Profit by day')}
          onAction={() => props.onOpen('profit')}
        />
        <HeadlineCard
          title={t('Paid by customers')}
          label={t('All time')}
          value={formatCny(data.customer_paid_micro_cny)}
          lines={[
            {
              label: t('Used'),
              value: formatCny(data.customer_used_micro_cny),
            },
            {
              label: t('Remaining'),
              value: formatCny(data.customer_remaining_micro_cny),
            },
          ]}
          action={t('Each customer')}
          onAction={() => props.onOpen('customers')}
        />
        <HeadlineCard
          title={t('Paid to upstreams')}
          label={t('All time')}
          value={formatCny(data.upstream_paid_micro_cny)}
          lines={[
            {
              label: t('Used'),
              value: formatCny(data.upstream_used_micro_cny),
            },
            {
              label: t('Remaining'),
              value: formatCny(data.upstream_remaining_micro_cny),
            },
          ]}
          action={t('Each upstream')}
          onAction={() => props.onOpen('upstreams')}
        />
        <HeadlineCard
          title={t('Other costs')}
          label={t('Month to date')}
          value={formatCny(data.month.expense_micro_cny)}
          lines={[
            {
              label: t('Today'),
              value: formatCny(data.today.expense_micro_cny),
            },
            {
              label: t('All time'),
              value: formatCny(data.all.expense_micro_cny),
            },
          ]}
          action={t('Ledger entries')}
          onAction={() => props.onOpen('entries')}
        />
      </div>
      <Card data-card-hover='false'>
        <CardContent className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-sm'>
            {t('Money that should be on hand')}
          </p>
          <p
            className={cn(
              'text-2xl font-semibold break-all tabular-nums',
              data.cash_micro_cny.startsWith('-') && 'text-destructive'
            )}
          >
            {formatCny(data.cash_micro_cny)}
          </p>
          <p className='text-sm'>
            {t(
              'Paid by customers {{paid}} − paid to upstreams {{upstream}} − other costs {{expense}}. This is not profit: money customers prepaid but have not used yet is in it too.',
              {
                paid: formatCny(data.customer_paid_micro_cny),
                upstream: formatCny(data.upstream_paid_micro_cny),
                expense: formatCny(data.all.expense_micro_cny),
              }
            )}
          </p>
        </CardContent>
      </Card>
      {data.pending_charges > 0 && (
        <Alert>
          <AlertDescription>
            {t(
              '{{count}} upstream deductions have no purchase price yet, so their cost is missing. Set it under Purchase and sale prices.',
              { count: data.pending_charges }
            )}
          </AlertDescription>
        </Alert>
      )}
      <p className='text-muted-foreground text-sm'>
        {t(
          'Profit = what customers used − what upstreams charged for it − other costs such as servers and promotion. Customer usage is valued at what each customer actually paid; gifted balance is used first and is worth nothing. Money paid to upstreams becomes cost as they deduct it, so it is not counted again when paid.'
        )}
      </p>
    </div>
  )
}
