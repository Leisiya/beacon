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

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getCashSummary } from '../api'
import type { CashRangeValues } from '../lib/cash-range'
import { ledgerMoney, ledgerQuota } from '../lib/form'
import { RangeForm } from './range-form'
import { SummaryMetrics } from './summary-metrics'

export function CashSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [range, setRange] = useState<CashRangeValues>({
    period: 'today',
    start: '',
    end: '',
  })
  const summary = useQuery({
    queryKey: ['beacon-ledger', 'cash-summary', range],
    queryFn: () => getCashSummary(range),
    retry: false,
    // Refresh on navigation/focus; do not silently retain yesterday's "today".
    staleTime: 0,
  })
  const data = summary.data
  const cashMetrics = data
    ? [
        { label: t('Recorded cash receipts'), value: data.receipt_minor },
        { label: t('Recorded cash refunds'), value: data.refund_minor },
        { label: t('Cash reversal adjustments'), value: data.reversal_minor },
        { label: t('Net recorded cash'), value: data.net_minor },
      ].map((metric) => ({
        ...metric,
        value: ledgerMoney(metric.value, 'CNY'),
      }))
    : []
  const quotaMetrics = data
    ? [
        { label: t('Purchased quota credited'), value: data.receipt_quota },
        { label: t('Gift quota credited'), value: data.gift_quota },
        {
          label: t('Quota withdrawn by corrections'),
          value: data.correction_quota,
        },
        { label: t('Quota used by requests'), value: data.usage_quota },
      ].map((metric) => ({
        ...metric,
        value: ledgerQuota(metric.value, locale),
      }))
    : []
  return (
    <TitledCard
      title={<h2>{t('Cash overview')}</h2>}
      description={t('All customers · CNY · Asia/Shanghai')}
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-5'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Only this manual ledger is included. Cash receipts are not usage revenue or profit. Historical top-ups and payment-provider records are excluded.'
          )}
        </p>
        <RangeForm
          idPrefix='cash'
          initial={range}
          fetching={summary.isFetching}
          refreshLabel={t('Refresh summary')}
          onApply={setRange}
          onRefresh={() => {
            void summary.refetch()
          }}
        />
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
              <br />
              {t('Calculated at')}:{' '}
              {new Date(data.range.as_of * 1000).toLocaleString(locale, {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}{' '}
              (UTC+08:00)
              {summary.isFetching && <span> · {t('Refreshing')}</span>}
            </p>
            <SummaryMetrics metrics={cashMetrics} />
            <p className='text-muted-foreground text-sm'>
              {t('Recorded entries')}: {formatNumber(data.entry_count, locale)}{' '}
              · {t('Gift entries (no cash)')}:{' '}
              {formatNumber(data.gift_count, locale)}
            </p>
            {data.entry_count === 0 && (
              <p>
                {t(
                  'No recorded entries in this period. These zeros do not represent a complete business balance.'
                )}
              </p>
            )}
            <p className='text-muted-foreground text-sm'>
              {t(
                'Net recorded cash = receipts − refunds + signed reversal adjustments. Each entry uses its saved CNY exchange-rate snapshot; refunds and reversals belong to their own occurrence dates.'
              )}
            </p>
            <h3 className='pt-2 font-medium'>{t('Quota movement')}</h3>
            <SummaryMetrics metrics={quotaMetrics} />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Quota credited and withdrawn comes from this ledger. Quota used is request charges minus refunds in the request logs for the same dates.'
              )}
            </p>
          </div>
        )}
        <p className='border-t pt-4 text-sm'>
          {t(
            'Upstream cost and estimated gross profit are under Profit and pricing. Exact revenue per receipt and unspent purchased balance: pending reliable usage attribution.'
          )}
        </p>
      </div>
    </TitledCard>
  )
}
