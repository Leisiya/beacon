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
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { cashRangeSchema, type CashRangeValues } from '../lib/cash-range'

// Shanghai reporting period picker shared by the cash and profit
// summaries. Extra controls (such as a grouping select) go in children.
export function RangeForm(props: {
  idPrefix: string
  initial: CashRangeValues
  fetching: boolean
  refreshLabel: string
  onApply: (values: CashRangeValues) => void
  onRefresh: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const form = useForm<CashRangeValues>({
    resolver: zodResolver(cashRangeSchema),
    defaultValues: props.initial,
  })
  const period = form.watch('period')
  const dateError = t(
    'Choose valid Shanghai dates, from 2000 through today, with the end on or after the start.'
  )
  return (
    <form
      className='flex flex-wrap items-end gap-3'
      onSubmit={form.handleSubmit((values) => props.onApply({ ...values }))}
    >
      <Field className='w-full sm:w-44'>
        <FieldLabel htmlFor={`${props.idPrefix}-period`}>
          {t('Reporting period')}
        </FieldLabel>
        <NativeSelect
          id={`${props.idPrefix}-period`}
          className='w-full [&_select]:min-h-11'
          {...form.register('period')}
        >
          <NativeSelectOption value='today'>{t('Today')}</NativeSelectOption>
          <NativeSelectOption value='month'>
            {t('Month to date')}
          </NativeSelectOption>
          <NativeSelectOption value='all'>{t('All time')}</NativeSelectOption>
          <NativeSelectOption value='custom'>
            {t('Custom dates')}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      {period === 'custom' && (
        <FieldGroup className='w-full gap-3 sm:w-92 sm:flex-row'>
          {(['start', 'end'] as const).map((name) => {
            const id = `${props.idPrefix}-${name}`
            const invalid = !!form.formState.errors[name]
            return (
              <Field key={name} className='min-w-0 sm:w-44'>
                <FieldLabel htmlFor={id}>
                  {name === 'start'
                    ? t('Start date (Shanghai)')
                    : t('End date (Shanghai)')}
                </FieldLabel>
                <Input
                  id={id}
                  type='date'
                  className='min-h-11'
                  min='2000-01-01'
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${id}-error` : undefined}
                  {...form.register(name)}
                />
                {invalid && (
                  <FieldError id={`${id}-error`}>{dateError}</FieldError>
                )}
              </Field>
            )
          })}
        </FieldGroup>
      )}
      {props.children}
      <Button className='min-h-11' type='submit' disabled={props.fetching}>
        {t('Apply range')}
      </Button>
      <Button
        className='min-h-11'
        variant='outline'
        type='button'
        disabled={props.fetching}
        onClick={props.onRefresh}
      >
        {props.refreshLabel}
      </Button>
    </form>
  )
}
