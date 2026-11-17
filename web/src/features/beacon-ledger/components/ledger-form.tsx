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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency, getCurrencyLabel } from '@/lib/currency'
import {
  formatNumber,
  parseQuotaFromDollars,
  quotaUnitsToEditableAmount,
} from '@/lib/format'

import { receiptFaceQuota, type LedgerFormValues } from '../lib/form'

export function LedgerFormFields(props: {
  locked: boolean
  correction: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { status } = useStatus()
  const form = useFormContext<LedgerFormValues>()
  const kind = form.watch('kind')
  const original = kind === 'receipt' || kind === 'gift'
  const cash = kind === 'receipt' || kind === 'refund'
  const amount = form.watch('amount')
  const cnyPerUnit = form.watch('cny_per_unit')
  const credit = form.watch('credit')
  const faceQuota =
    kind === 'receipt'
      ? receiptFaceQuota(amount, cnyPerUnit, Number(status?.price))
      : null
  const creditQuota = parseQuotaFromDollars(Number(credit))
  const balance = (quota: number): string =>
    formatQuotaWithCurrency(quota, { abbreviate: false, locale })

  // Until the operator types a balance, a receipt credits its list-price value.
  // Reading dirtyFields during render subscribes the form to it.
  const creditEdited = !!form.formState.dirtyFields.credit
  const setValue = form.setValue
  useEffect(() => {
    if (faceQuota === null || creditEdited) return
    setValue('credit', String(quotaUnitsToEditableAmount(faceQuota)))
  }, [creditEdited, faceQuota, setValue])

  const fields: {
    name: keyof LedgerFormValues
    label: string
    type?: string
  }[] = [
    original
      ? { name: 'user_id' as const, label: 'Customer ID' }
      : { name: 'corrects_id' as const, label: 'Original entry ID' },
    // The payment comes first because it prefills the balance to credit.
    ...(kind === 'receipt'
      ? [{ name: 'amount' as const, label: 'Original currency amount' }]
      : []),
    ...(cash
      ? [
          {
            name: 'cny_per_unit' as const,
            label: 'CNY per original currency unit',
          },
        ]
      : []),
    ...(original
      ? [{ name: 'credit' as const, label: 'Balance to credit ({{currency}})' }]
      : []),
    ...(cash
      ? [
          { name: 'fx_source' as const, label: 'Exchange rate source' },
          { name: 'payment_method' as const, label: 'Payment method' },
          {
            name: 'payment_reference' as const,
            label: 'External payment reference',
          },
        ]
      : []),
    {
      name: 'occurred_at',
      label: 'Occurred at (Asia/Shanghai)',
      type: 'datetime-local',
    },
    { name: 'note', label: 'Reason / evidence' },
  ]
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
          <NativeSelectOption value='receipt'>
            {t('Manual receipt')}
          </NativeSelectOption>
          <NativeSelectOption value='gift'>
            {t('Gift quota')}
          </NativeSelectOption>
          {props.correction && (
            <NativeSelectOption value='refund'>
              {t('Full refund')}
            </NativeSelectOption>
          )}
          {props.correction && (
            <NativeSelectOption value='reversal'>
              {t('Reverse entry')}
            </NativeSelectOption>
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
            {...form.register('currency')}
          >
            {['CNY', 'USD', 'EUR', 'HKD'].map((currency) => (
              <NativeSelectOption key={currency} value={currency}>
                {currency}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      {fields.map((field) => {
        const error = form.formState.errors[field.name]?.message
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
              readOnly={props.locked || field.name === 'corrects_id'}
              aria-invalid={!!error}
              aria-describedby={
                [
                  error && `ledger-error-${field.name}`,
                  field.name === 'credit' && 'ledger-credit-preview',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              {...form.register(field.name)}
            />
            {field.name === 'credit' && creditQuota > 0 && (
              <FieldDescription id='ledger-credit-preview'>
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
