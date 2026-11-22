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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TitledCard } from '@/components/ui/titled-card'
import { handleServerError } from '@/lib/handle-server-error'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { postReferencePrice } from '../api'

const referenceSchema = z.object({
  cny_per_unit: z
    .string()
    .trim()
    .regex(/^(0|[1-9][0-9]{0,4})(\.[0-9]{1,8})?$/)
    .refine((value) => Number(value) > 0),
})
type ReferenceValues = z.infer<typeof referenceSchema>

// The top-up price ties CNY to the USD balance: receipts are prefilled with
// it, and sale prices and customer usage are shown in CNY through it.
export function ReferencePriceCard(props: { cnyPerUnit: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const form = useForm<ReferenceValues>({
    resolver: zodResolver(referenceSchema),
    values: { cny_per_unit: String(props.cnyPerUnit) },
  })
  const save = useMutation({
    mutationFn: (values: ReferenceValues) =>
      postReferencePrice(values.cny_per_unit),
    onSuccess: () => {
      toast.success(t('Top-up price saved'))
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      setOpen(false)
    },
    onError: (error) => handleServerError(error),
  })
  const error = form.formState.errors.cny_per_unit
  return (
    <TitledCard
      title={<h2>{t('Top-up price')}</h2>}
      description={t(
        'What a customer pays for $1 of balance. Manual receipts are prefilled with it, and sale prices are shown in CNY through it. Profit uses what each customer actually paid.'
      )}
      action={
        <Button
          className='min-h-11'
          variant='outline'
          onClick={() => setOpen(true)}
        >
          {t('Change top-up price')}
        </Button>
      }
      disableHoverEffect
    >
      <p className='text-xl font-semibold tabular-nums'>
        {t('¥{{price}} = $1 of balance', { price: props.cnyPerUnit })}
      </p>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Change top-up price')}
        description={t(
          'Balances already credited stay as they are. Model prices in USD do not change, but their CNY value does.'
        )}
      >
        <form
          className='flex flex-col gap-4'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <Field>
            <FieldLabel htmlFor='reference-price'>
              {t('CNY for $1 of balance')}
            </FieldLabel>
            <Input
              id='reference-price'
              className='min-h-11'
              inputMode='decimal'
              aria-invalid={!!error}
              {...form.register('cny_per_unit')}
            />
            {error && (
              <FieldError>
                {t('Enter a positive number with up to 8 decimal places.')}
              </FieldError>
            )}
          </Field>
          <Button className='min-h-11' type='submit' disabled={save.isPending}>
            {t('Save top-up price')}
          </Button>
        </form>
      </Dialog>
    </TitledCard>
  )
}
