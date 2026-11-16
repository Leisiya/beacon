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

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getQuotaReconciliation } from '../api'
import { ledgerQuota } from '../lib/form'
import { SummaryMetrics } from './summary-metrics'

export function QuotaReconciliation() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const report = useQuery({
    queryKey: ['beacon-ledger', 'reconciliation'],
    queryFn: getQuotaReconciliation,
    retry: false,
    staleTime: 0,
  })
  const data = report.data
  return (
    <TitledCard
      title={<h2>{t('Balance reconciliation')}</h2>}
      description={t('All accounts · current snapshot')}
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-5'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'For every account, remaining balance plus quota used should equal the quota credited in this ledger. A difference means quota changed outside the ledger, such as a sign-up bonus, check-in, redemption code or balance purchase, or that a request is still in progress.'
          )}
        </p>
        <div>
          <Button
            className='min-h-11'
            variant='outline'
            disabled={report.isFetching}
            onClick={() => {
              void report.refetch()
            }}
          >
            {t('Refresh')}
          </Button>
        </div>
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
              {t('Calculated at')}:{' '}
              {new Date(data.as_of * 1000).toLocaleString(locale, {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}{' '}
              (UTC+08:00)
            </p>
            <SummaryMetrics
              metrics={[
                { label: t('Quota credited in ledger'), value: data.ledger_quota },
                { label: t('Remaining balance'), value: data.balance_quota },
                { label: t('Quota used'), value: data.used_quota },
                { label: t('Difference'), value: data.difference },
              ].map((metric) => ({
                ...metric,
                value: ledgerQuota(metric.value, locale),
              }))}
            />
            {data.mismatch_count === 0 ? (
              <Alert>
                <AlertDescription>
                  {t('Every account reconciles with the ledger.')}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t(
                      '{{count}} accounts do not reconcile. Check their usage and balance logs before recording any correction.',
                      { count: data.mismatch_count }
                    )}
                  </AlertDescription>
                </Alert>
                <StaticDataTable
                  className='overflow-x-auto'
                  tableProps={{ withContainer: false }}
                  data={data.mismatches}
                  getRowKey={(row) => row.user_id}
                  containerProps={{
                    role: 'region',
                    'aria-label': t('Accounts that do not reconcile'),
                    tabIndex: 0,
                  }}
                  tableClassName='min-w-[600px]'
                  columns={[
                    {
                      id: 'user',
                      header: t('Customer ID'),
                      cell: (row) =>
                        row.username
                          ? `${formatNumber(row.user_id, locale)} · ${row.username}`
                          : formatNumber(row.user_id, locale),
                    },
                    {
                      id: 'ledger',
                      header: t('Quota credited in ledger'),
                      cell: (row) => formatNumber(row.ledger_quota, locale),
                    },
                    {
                      id: 'balance',
                      header: t('Remaining balance'),
                      cell: (row) => formatNumber(row.balance_quota, locale),
                    },
                    {
                      id: 'used',
                      header: t('Quota used'),
                      cell: (row) => formatNumber(row.used_quota, locale),
                    },
                    {
                      id: 'difference',
                      header: t('Difference'),
                      cell: (row) => formatNumber(row.difference, locale),
                    },
                  ]}
                />
                {data.mismatch_count > data.mismatches.length && (
                  <p className='text-muted-foreground text-sm'>
                    {t('Showing the first {{shown}} of {{count}} accounts.', {
                      shown: data.mismatches.length,
                      count: data.mismatch_count,
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </TitledCard>
  )
}
