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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getCashSummary } from '../api'
import { cashRangeSchema, type CashRangeValues } from '../lib/cash-range'
import { ledgerMoney } from '../lib/form'

export function CashSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [range, setRange] = useState<CashRangeValues>({
    period: 'today',
    start: '',
    end: '',
  })
  const form = useForm<CashRangeValues>({
    resolver: zodResolver(cashRangeSchema),
    defaultValues: range,
  })
  const period = form.watch('period')
  const summary = useQuery({
    queryKey: ['beacon-ledger', 'cash-summary', range],
    queryFn: () => getCashSummary(range),
    retry: false,
    // Refresh on navigation/focus; do not silently retain yesterday's "today".
    staleTime: 0,
  })
  const data = summary.data
  const metrics = data
    ? [
        { label: t('Recorded cash receipts'), value: data.receipt_minor },
        { label: t('Recorded cash refunds'), value: data.refund_minor },
        { label: t('Cash reversal adjustments'), value: data.reversal_minor },
        { label: t('Net recorded cash'), value: data.net_minor },
      ]
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
        <form
          className='flex flex-wrap items-end gap-3'
          onSubmit={form.handleSubmit((values) => setRange({ ...values }))}
        >
          <Field className='w-full sm:w-44'>
            <FieldLabel htmlFor='cash-period'>
              {t('Reporting period')}
            </FieldLabel>
            <NativeSelect
              id='cash-period'
              className='w-full [&_select]:min-h-11'
              {...form.register('period')}
            >
              <NativeSelectOption value='today'>
                {t('Today')}
              </NativeSelectOption>
              <NativeSelectOption value='month'>
                {t('Month to date')}
              </NativeSelectOption>
              <NativeSelectOption value='all'>
                {t('All time')}
              </NativeSelectOption>
              <NativeSelectOption value='custom'>
                {t('Custom dates')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          {period === 'custom' && (
            <FieldGroup className='w-full gap-3 sm:w-92 sm:flex-row'>
              <Field className='min-w-0 sm:w-44'>
                <FieldLabel htmlFor='cash-start'>
                  {t('Start date (Shanghai)')}
                </FieldLabel>
                <Input
                  id='cash-start'
                  type='date'
                  className='min-h-11'
                  min='2000-01-01'
                  aria-invalid={!!form.formState.errors.start}
                  aria-describedby={
                    form.formState.errors.start ? 'cash-start-error' : undefined
                  }
                  {...form.register('start')}
                />
                {form.formState.errors.start && (
                  <FieldError id='cash-start-error'>
                    {t(
                      'Choose valid Shanghai dates, from 2000 through today, with the end on or after the start.'
                    )}
                  </FieldError>
                )}
              </Field>
              <Field className='min-w-0 sm:w-44'>
                <FieldLabel htmlFor='cash-end'>
                  {t('End date (Shanghai)')}
                </FieldLabel>
                <Input
                  id='cash-end'
                  type='date'
                  className='min-h-11'
                  min='2000-01-01'
                  aria-invalid={!!form.formState.errors.end}
                  aria-describedby={
                    form.formState.errors.end ? 'cash-end-error' : undefined
                  }
                  {...form.register('end')}
                />
                {form.formState.errors.end && (
                  <FieldError id='cash-end-error'>
                    {t(
                      'Choose valid Shanghai dates, from 2000 through today, with the end on or after the start.'
                    )}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
          )}
          <Button
            className='min-h-11'
            type='submit'
            disabled={summary.isFetching}
          >
            {t('Apply range')}
          </Button>
          <Button
            className='min-h-11'
            variant='outline'
            type='button'
            disabled={summary.isFetching}
            onClick={() => {
              void summary.refetch()
            }}
          >
            {t('Refresh summary')}
          </Button>
        </form>
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
            <div className='grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              {metrics.map((metric) => (
                <Card key={metric.label} data-card-hover='false'>
                  <CardHeader>
                    <CardTitle>{metric.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className='text-xl font-semibold break-all tabular-nums'>
                      {ledgerMoney(metric.value, 'CNY')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
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
          </div>
        )}
        <p className='border-t pt-4 text-sm'>
          {t(
            'Usage revenue, unspent purchased balance, upstream costs and gross profit: pending reliable usage attribution and cost records.'
          )}
        </p>
      </div>
    </TitledCard>
  )
}
