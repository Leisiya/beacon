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
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'

import { bpToPercent, percentToBp } from '../lib/pricing'
import type { PricingRule, PricingRuleInput } from '../types'

const percent = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,4}(\.\d{1,2})?$/)
    .refine((value) => Number(value) >= min && Number(value) <= max)

const ruleSchema = z.object({
  mode: z.enum(['cost_plus', 'fixed']),
  markup: percent(0, 1000),
  minMarkup: percent(-100, 1000),
  apply: z.enum(['confirm', 'auto']),
  followDown: z.boolean(),
  maxStep: percent(1, 1000),
})
type RuleValues = z.infer<typeof ruleSchema>

// One price rule: the default rule or a model override share this form.
export function PriceRuleForm(props: {
  idPrefix: string
  rule: PricingRule
  modelName: string
  submitLabel: string
  pending: boolean
  onSubmit: (rule: PricingRuleInput) => void
}) {
  const { t } = useTranslation()
  const form = useForm<RuleValues>({
    resolver: zodResolver(ruleSchema),
    values: {
      mode: props.rule.mode,
      markup: bpToPercent(props.rule.markup_bp),
      minMarkup: bpToPercent(props.rule.min_markup_bp),
      apply: props.rule.auto_apply ? 'auto' : 'confirm',
      followDown: props.rule.follow_down,
      maxStep: bpToPercent(props.rule.max_step_bp),
    },
  })
  const errors = form.formState.errors
  const mode = form.watch('mode')
  const id = (name: string) => `${props.idPrefix}-${name}`
  const percentField = (
    name: 'markup' | 'minMarkup' | 'maxStep',
    label: string,
    description: string
  ) => (
    <Field>
      <FieldLabel htmlFor={id(name)}>{label}</FieldLabel>
      <Input
        id={id(name)}
        className='min-h-11'
        inputMode='decimal'
        aria-invalid={!!errors[name]}
        {...form.register(name)}
      />
      <FieldDescription>{description}</FieldDescription>
      {errors[name] && (
        <FieldError>
          {t('Enter a percentage with up to 2 decimals.')}
        </FieldError>
      )}
    </Field>
  )
  return (
    <form
      className='grid min-w-0 gap-4 sm:grid-cols-2'
      onSubmit={form.handleSubmit((values) =>
        props.onSubmit({
          model_name: props.modelName,
          mode: values.mode,
          markup_bp: percentToBp(values.markup),
          min_markup_bp: percentToBp(values.minMarkup),
          auto_apply: values.apply === 'auto',
          follow_down: values.followDown,
          max_step_bp: percentToBp(values.maxStep),
        })
      )}
    >
      <Field>
        <FieldLabel htmlFor={id('mode')}>
          {t('When upstream prices change')}
        </FieldLabel>
        <NativeSelect
          id={id('mode')}
          className='w-full [&_select]:min-h-11'
          {...form.register('mode')}
        >
          <NativeSelectOption value='cost_plus'>
            {t('Follow cost: sale = cost × (1 + markup)')}
          </NativeSelectOption>
          <NativeSelectOption value='fixed'>
            {t('Keep a fixed sale price and only alert')}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      {percentField(
        'markup',
        t('Target markup (%)'),
        t('Markup over the most expensive supplier serving the model.')
      )}
      {percentField(
        'minMarkup',
        t('Alert below markup (%)'),
        t('Administrators are notified when a model falls below this.')
      )}
      {mode === 'cost_plus' && (
        <>
          <Field>
            <FieldLabel htmlFor={id('apply')}>
              {t('How changes take effect')}
            </FieldLabel>
            <NativeSelect
              id={id('apply')}
              className='w-full [&_select]:min-h-11'
              {...form.register('apply')}
            >
              <NativeSelectOption value='confirm'>
                {t('Suggest, then apply after confirmation')}
              </NativeSelectOption>
              <NativeSelectOption value='auto'>
                {t('Apply automatically within the limits')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          {percentField(
            'maxStep',
            t('Largest automatic change (%)'),
            t(
              'Larger rises or falls, a second change within 24 hours, and supplier prices that did not reproduce their charges wait for confirmation.'
            )
          )}
          <Field orientation='horizontal' className='min-h-11 items-center'>
            <Controller
              control={form.control}
              name='followDown'
              render={({ field }) => (
                <Switch
                  id={id('follow-down')}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <FieldLabel htmlFor={id('follow-down')}>
              {t('Lower the sale price when upstream prices fall')}
            </FieldLabel>
          </Field>
        </>
      )}
      <div className='sm:col-span-2'>
        <Button className='min-h-11' type='submit' disabled={props.pending}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  )
}
