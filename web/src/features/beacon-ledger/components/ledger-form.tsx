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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { LedgerFormValues } from '../lib/form'

export function LedgerFormFields(props: {
  locked: boolean
  correction: boolean
}) {
  const { t } = useTranslation()
  const form = useFormContext<LedgerFormValues>()
  const kind = form.watch('kind')
  const original = kind === 'receipt' || kind === 'gift'
  const cash = kind === 'receipt' || kind === 'refund'
  const fields: {
    name: keyof LedgerFormValues
    label: string
    type?: string
  }[] = [
    ...(original
      ? [
          { name: 'user_id' as const, label: 'Customer ID' },
          { name: 'quota' as const, label: 'Quota units to add' },
        ]
      : [{ name: 'corrects_id' as const, label: 'Original entry ID' }]),
    ...(kind === 'receipt'
      ? [{ name: 'amount' as const, label: 'Original currency amount' }]
      : []),
    ...(cash
      ? [
          {
            name: 'cny_per_unit' as const,
            label: 'CNY per original currency unit',
          },
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
              {t(field.label)}
            </FieldLabel>
            <Input
              className='min-h-11'
              id={`ledger-${field.name}`}
              type={field.type ?? 'text'}
              readOnly={props.locked || field.name === 'corrects_id'}
              aria-invalid={!!error}
              aria-describedby={
                error ? `ledger-error-${field.name}` : undefined
              }
              {...form.register(field.name)}
            />
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
