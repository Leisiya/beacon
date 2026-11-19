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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { postUpstreamRate } from '../api'
import { fromShanghaiInput, toShanghaiInput } from '../lib/cost'
import type { CostSource } from '../types'

const rateSchema = z.object({
  cny_per_unit: z
    .string()
    .trim()
    .regex(/^(0|[1-9][0-9]{0,4})(\.[0-9]{1,8})?$/)
    .refine((value) => Number(value) > 0),
  effective_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .refine((value) => Number.isFinite(fromShanghaiInput(value))),
  note: z.string().max(500),
})
type RateValues = z.infer<typeof rateSchema>

export function UpstreamRateDialog(props: {
  source: CostSource | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const form = useForm<RateValues>({
    resolver: zodResolver(rateSchema),
    values: {
      cny_per_unit: props.source?.rates[0]?.cny_per_unit ?? '',
      effective_at: toShanghaiInput(Math.floor(Date.now() / 1000)),
      note: '',
    },
  })
  const save = useMutation({
    mutationFn: (values: RateValues) =>
      postUpstreamRate({
        channel_id: props.source?.id ?? 0,
        cny_per_unit: values.cny_per_unit,
        effective_at: fromShanghaiInput(values.effective_at),
        note: values.note,
      }),
    onSuccess: () => {
      toast.success(t('Upstream rate saved'))
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })
  const errors = form.formState.errors
  return (
    <Dialog
      open={!!props.source}
      onOpenChange={props.onOpenChange}
      title={t('Upstream rate · {{name}}', { name: props.source?.name })}
      description={t(
        'How much CNY one unit of this upstream’s credit (what it shows as $1) actually cost you, for example 1 when ¥1 buys $1.'
      )}
    >
      <form
        className='flex flex-col gap-4'
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <Field>
          <FieldLabel htmlFor='rate-cny'>
            {t('CNY per upstream credit unit')}
          </FieldLabel>
          <Input
            id='rate-cny'
            className='min-h-11'
            inputMode='decimal'
            aria-invalid={!!errors.cny_per_unit}
            {...form.register('cny_per_unit')}
          />
          {errors.cny_per_unit && (
            <FieldError>
              {t('Enter a positive number with up to 8 decimal places.')}
            </FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor='rate-effective'>
            {t('Effective from (Asia/Shanghai)')}
          </FieldLabel>
          <Input
            id='rate-effective'
            type='datetime-local'
            className='min-h-11'
            aria-invalid={!!errors.effective_at}
            {...form.register('effective_at')}
          />
          {errors.effective_at && (
            <FieldError>{t('Choose a valid date and time.')}</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor='rate-note'>{t('Reason / evidence')}</FieldLabel>
          <Textarea id='rate-note' maxLength={500} {...form.register('note')} />
        </Field>
        <p className='text-muted-foreground text-sm'>
          {t(
            'A new rate prices requests synced from its effective time on, plus earlier requests that had no rate. Requests that already have a cost keep it.'
          )}
        </p>
        <Button className='min-h-11' type='submit' disabled={save.isPending}>
          {t('Save rate')}
        </Button>
      </form>
      {props.source && props.source.rates.length > 0 && (
        <section className='mt-6 flex flex-col gap-2'>
          <h3 className='font-medium'>{t('Rate history')}</h3>
          <ul className='flex flex-col gap-2 text-sm'>
            {props.source.rates.map((rate) => (
              <li key={rate.id} className='rounded-md border p-3 break-words'>
                <span className='font-medium tabular-nums'>
                  ¥{rate.cny_per_unit}
                </span>{' '}
                ·{' '}
                {new Date(rate.effective_at * 1000).toLocaleString(locale, {
                  timeZone: 'Asia/Shanghai',
                  hour12: false,
                })}
                {rate.note && (
                  <p className='text-muted-foreground mt-1'>{rate.note}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  )
}
