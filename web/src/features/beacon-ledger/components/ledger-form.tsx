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
import { useEffect } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency, getCurrencyLabel } from '@/lib/currency'
import {
  formatNumber,
  parseQuotaFromDollars,
  quotaUnitsToEditableAmount,
} from '@/lib/format'

import { getCostSources } from '../api'
import {
  entryKindLabels,
  entrySource,
  receiptFaceQuota,
  type LedgerFormValues,
} from '../lib/form'

type FieldSpec = {
  name: keyof LedgerFormValues
  label: string
  type?: string
  decimal?: boolean
}

export function LedgerFormFields(props: {
  locked: boolean
  correction: boolean
  // The currency of the entry a refund corrects; a CNY refund needs no rate.
  sourceCurrency?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { status } = useStatus()
  const form = useFormContext<LedgerFormValues>()
  const kind = form.watch('kind')
  const source = entrySource(kind)
  const original = kind === 'receipt' || kind === 'gift'
  const currency = form.watch('currency')
  const amount = form.watch('amount')
  const cnyPerUnit = form.watch('cny_per_unit')
  const credit = form.watch('credit')
  const channelId = Number(form.watch('channel_id'))
  const upstreams = useQuery({
    queryKey: ['beacon-ledger', 'cost-sources'],
    queryFn: getCostSources,
    enabled: kind === 'upstream',
    retry: false,
  })
  // Rates come newest first; the first one in effect is the purchase price.
  const purchaseRate = upstreams.data?.sources
    .find((upstream) => upstream.id === channelId)
    ?.rates.find(
      (rate) => rate.effective_at <= upstreams.data.now
    )?.cny_per_unit
  const faceQuota =
    kind === 'receipt'
      ? receiptFaceQuota(amount, cnyPerUnit, Number(status?.price))
      : null
  const creditQuota = parseQuotaFromDollars(Number(credit))
  const balance = (quota: number): string =>
    formatQuotaWithCurrency(quota, { abbreviate: false, locale })

  // Until the operator types a balance, a receipt credits its list-price value
  // and a top-up the credit its purchase price buys. Reading dirtyFields
  // during render subscribes the form to it.
  const creditEdited = !!form.formState.dirtyFields.credit
  const upstreamCreditEdited = !!form.formState.dirtyFields.upstream_credit
  const setValue = form.setValue
  useEffect(() => {
    if (faceQuota === null || creditEdited) return
    setValue('credit', String(quotaUnitsToEditableAmount(faceQuota)))
  }, [creditEdited, faceQuota, setValue])
  useEffect(() => {
    if (kind !== 'upstream' || upstreamCreditEdited || !purchaseRate) return
    const bought = Number(amount) / Number(purchaseRate)
    setValue(
      'upstream_credit',
      bought > 0 && Number.isFinite(bought)
        ? String(Number(bought.toFixed(6)))
        : ''
    )
  }, [amount, kind, purchaseRate, setValue, upstreamCreditEdited])

  const fields: FieldSpec[] = []
  if (original) fields.push({ name: 'user_id', label: 'Customer ID' })
  if (props.correction) {
    fields.push({ name: 'corrects_id', label: 'Original entry ID' })
  }
  // The payment comes first because it prefills the balance to credit.
  if (kind === 'receipt') {
    fields.push({
      name: 'amount',
      label: 'Original currency amount',
      decimal: true,
    })
  }
  if (
    (kind === 'receipt' && currency !== 'CNY') ||
    (kind === 'refund' && props.sourceCurrency !== 'CNY')
  ) {
    fields.push({
      name: 'cny_per_unit',
      label: 'CNY per original currency unit',
      decimal: true,
    })
  }
  if (original) {
    fields.push({
      name: 'credit',
      label: 'Balance to credit ({{currency}})',
      decimal: true,
    })
  }
  if (kind === 'receipt' || kind === 'refund') {
    fields.push(
      { name: 'payment_method', label: 'Payment method' },
      { name: 'payment_reference', label: 'External payment reference' }
    )
  }
  if (kind === 'upstream') {
    fields.push(
      { name: 'amount', label: 'CNY paid', decimal: true },
      {
        name: 'upstream_credit',
        label: 'Credit received (upstream $)',
        decimal: true,
      }
    )
  }
  if (source === 'expense') {
    fields.push({ name: 'amount', label: 'Amount (CNY)', decimal: true })
  }
  fields.push({
    name: 'occurred_at',
    label: 'Occurred at (Asia/Shanghai)',
    type: 'datetime-local',
  })
  if (source !== 'customer') {
    fields.push({ name: 'note', label: 'Note (optional)' })
  }
  const channelError = form.formState.errors.channel_id?.message
  return (
    <FieldGroup className='grid gap-4 sm:grid-cols-2'>
      <Field data-disabled={props.locked}>
        <FieldLabel htmlFor='ledger-kind'>{t('Entry type')}</FieldLabel>
        <NativeSelect
          className='[&_select]:min-h-11'
          id='ledger-kind'
          disabled={props.locked || props.correction}
          {...form.register('kind')}
        >
          {props.correction ? (
            (['refund', 'reversal'] as const).map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(entryKindLabels[value])}
              </NativeSelectOption>
            ))
          ) : (
            <>
              <NativeSelectOptGroup label={t('Customer money')}>
                {(['receipt', 'gift'] as const).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {t(entryKindLabels[value])}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
              <NativeSelectOptGroup label={t('Money paid out')}>
                {(['upstream', 'server', 'promotion', 'other'] as const).map(
                  (value) => (
                    <NativeSelectOption key={value} value={value}>
                      {t(entryKindLabels[value])}
                    </NativeSelectOption>
                  )
                )}
              </NativeSelectOptGroup>
            </>
          )}
        </NativeSelect>
      </Field>
      {kind === 'receipt' && (
        <Field data-disabled={props.locked}>
          <FieldLabel htmlFor='ledger-currency'>
            {t('Original currency')}
          </FieldLabel>
          <NativeSelect
            className='[&_select]:min-h-11'
            id='ledger-currency'
            disabled={props.locked}
            {...form.register('currency', {
              // CNY is always 1:1; another currency needs its own rate.
              onChange: (event: { target: { value: string } }) =>
                setValue(
                  'cny_per_unit',
                  event.target.value === 'CNY' ? '1' : ''
                ),
            })}
          >
            {['CNY', 'USD', 'EUR', 'HKD'].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      {kind === 'upstream' && (
        <Field data-invalid={!!channelError} data-disabled={props.locked}>
          <FieldLabel htmlFor='ledger-channel_id'>{t('Upstream')}</FieldLabel>
          {/* Mounted once the options exist, so a preselected upstream shows. */}
          {upstreams.isSuccess ? (
            <NativeSelect
              className='[&_select]:min-h-11'
              id='ledger-channel_id'
              disabled={props.locked}
              aria-invalid={!!channelError}
              aria-describedby={
                channelError ? 'ledger-error-channel_id' : undefined
              }
              {...form.register('channel_id')}
            >
              <NativeSelectOption value=''>
                {t('Choose an upstream')}
              </NativeSelectOption>
              {upstreams.data.sources.map((upstream) => (
                <NativeSelectOption
                  key={upstream.id}
                  value={String(upstream.id)}
                >
                  {upstream.name} #{upstream.id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <NativeSelect
              className='[&_select]:min-h-11'
              id='ledger-channel_id'
              disabled
            >
              <NativeSelectOption value=''>
                {upstreams.isError
                  ? t('Unable to load upstreams')
                  : t('Loading...')}
              </NativeSelectOption>
            </NativeSelect>
          )}
          {channelError && (
            <FieldError id='ledger-error-channel_id'>
              {t(channelError)}
            </FieldError>
          )}
        </Field>
      )}
      {fields.map((field) => {
        const error = form.formState.errors[field.name]?.message
        const description =
          (field.name === 'credit' && creditQuota > 0) ||
          (field.name === 'upstream_credit' && !!purchaseRate)
        return (
          <Field
            key={field.name}
            data-invalid={!!error}
            data-disabled={props.locked}
          >
            <FieldLabel htmlFor={`ledger-${field.name}`}>
              {t(field.label, { currency: getCurrencyLabel() })}
            </FieldLabel>
            <Input
              className='min-h-11'
              id={`ledger-${field.name}`}
              type={field.type ?? 'text'}
              inputMode={field.decimal ? 'decimal' : undefined}
              maxLength={field.name === 'note' ? 500 : undefined}
              readOnly={props.locked || field.name === 'corrects_id'}
              aria-invalid={!!error}
              aria-describedby={
                [
                  error && `ledger-error-${field.name}`,
                  description && `ledger-hint-${field.name}`,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              {...form.register(field.name)}
            />
            {field.name === 'credit' && creditQuota > 0 && (
              <FieldDescription id='ledger-hint-credit'>
                {t('Customer balance +{{balance}} ({{quota}} quota units)', {
                  balance: balance(creditQuota),
                  quota: formatNumber(creditQuota, locale),
                })}
                {faceQuota !== null && faceQuota !== creditQuota && (
                  <span className='text-foreground block'>
                    {t(
                      'At the top-up price this payment buys {{balance}}; check any discount or bonus.',
                      { balance: balance(faceQuota) }
                    )}
                  </span>
                )}
              </FieldDescription>
            )}
            {field.name === 'upstream_credit' && purchaseRate && (
              <FieldDescription id='ledger-hint-upstream_credit'>
                {t(
                  'Filled in at the purchase price ¥{{rate}} per $1. Change it if the upstream gave a bonus.',
                  { rate: purchaseRate }
                )}
              </FieldDescription>
            )}
            {error && (
              <FieldError id={`ledger-error-${field.name}`}>
                {t(error)}
              </FieldError>
            )}
          </Field>
        )
      })}
    </FieldGroup>
  )
}
