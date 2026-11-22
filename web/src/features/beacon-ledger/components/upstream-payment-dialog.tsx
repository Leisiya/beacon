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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { getUpstreamPayments, postUpstreamPayment } from '../api'
import {
  formatCny,
  formatCredit,
  fromShanghaiInput,
  toShanghaiInput,
} from '../lib/cost'
import { newRequestKey } from '../lib/form'
import type { UpstreamFinanceRow, UpstreamPayment } from '../types'

const paymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/)
    .refine((value) => Number(value) > 0),
  credit: z
    .string()
    .trim()
    .regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/)
    .refine((value) => Number(value) > 0),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .refine((value) => Number.isFinite(fromShanghaiInput(value))),
  note: z.string().max(500),
})
type PaymentValues = z.infer<typeof paymentSchema>

function centsToMicro(cents: number): string {
  return String(BigInt(cents) * 10_000n)
}

function emptyPayment(): PaymentValues {
  return {
    amount: '',
    credit: '',
    occurred_at: toShanghaiInput(Math.floor(Date.now() / 1000)),
    note: '',
  }
}

// Records money sent to one upstream and lists earlier payments. A payment
// is never edited: a mistake is cancelled by a reversal with a reason.
export function UpstreamPaymentDialog(props: {
  row: UpstreamFinanceRow | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const channelId = props.row?.channel_id ?? 0
  const rate = Number(props.row?.cny_per_unit)
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [reversing, setReversing] = useState<UpstreamPayment | null>(null)
  const [reason, setReason] = useState('')
  const form = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: emptyPayment(),
  })
  const payments = useQuery({
    queryKey: ['beacon-ledger', 'upstream-payments', channelId],
    queryFn: () => getUpstreamPayments(channelId),
    enabled: channelId > 0,
    retry: false,
  })
  const save = useMutation({
    mutationFn: (values: PaymentValues) =>
      postUpstreamPayment({
        request_key: requestKey,
        channel_id: channelId,
        amount: values.amount,
        credit: values.credit,
        corrects_id: 0,
        occurred_at: fromShanghaiInput(values.occurred_at),
        note: values.note,
      }),
    onSuccess: () => {
      toast.success(t('Payment recorded'))
      form.reset(emptyPayment())
      setRequestKey(newRequestKey())
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
    },
    onError: (error) => handleServerError(error),
  })
  const reverse = useMutation({
    mutationFn: (payment: UpstreamPayment) =>
      postUpstreamPayment({
        request_key: newRequestKey(),
        channel_id: 0,
        amount: '',
        credit: '',
        corrects_id: payment.id,
        occurred_at: Math.floor(Date.now() / 1000),
        note: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(t('Payment reversed'))
      setReversing(null)
      setReason('')
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
    },
    onError: (error) => handleServerError(error),
  })
  const errors = form.formState.errors
  const amountField = form.register('amount', {
    onChange: (event: { target: { value: string } }) => {
      if (form.getFieldState('credit').isDirty || !(rate > 0)) return
      const credit = Number(event.target.value) / rate
      form.setValue(
        'credit',
        credit > 0 && Number.isFinite(credit)
          ? String(Number(credit.toFixed(6)))
          : ''
      )
    },
  })
  return (
    <>
      <Dialog
        open={!!props.row}
        onOpenChange={props.onOpenChange}
        title={t('Payments to {{name}}', { name: props.row?.name })}
        description={t(
          'Record each time you top up this upstream: the CNY you sent and the credit it added.'
        )}
      >
        <form
          className='flex flex-col gap-4'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <Field>
            <FieldLabel htmlFor='payment-amount'>{t('CNY paid')}</FieldLabel>
            <Input
              id='payment-amount'
              className='min-h-11'
              inputMode='decimal'
              aria-invalid={!!errors.amount}
              {...amountField}
            />
            {errors.amount && (
              <FieldError>
                {t('Enter an amount above 0 with up to two decimal places.')}
              </FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor='payment-credit'>
              {t('Credit received (upstream $)')}
            </FieldLabel>
            <Input
              id='payment-credit'
              className='min-h-11'
              inputMode='decimal'
              aria-invalid={!!errors.credit}
              {...form.register('credit')}
            />
            {errors.credit && (
              <FieldError>
                {t('Enter credit above 0 with up to six decimal places.')}
              </FieldError>
            )}
            {rate > 0 && (
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Filled in at the purchase price ¥{{rate}} per $1. Change it if the upstream gave a bonus.',
                  { rate: props.row?.cny_per_unit }
                )}
              </p>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor='payment-time'>
              {t('Paid at (Asia/Shanghai)')}
            </FieldLabel>
            <Input
              id='payment-time'
              type='datetime-local'
              className='min-h-11'
              aria-invalid={!!errors.occurred_at}
              {...form.register('occurred_at')}
            />
            {errors.occurred_at && (
              <FieldError>{t('Choose a valid date and time.')}</FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor='payment-note'>{t('Note')}</FieldLabel>
            <Textarea
              id='payment-note'
              maxLength={500}
              {...form.register('note')}
            />
          </Field>
          <Button className='min-h-11' type='submit' disabled={save.isPending}>
            {t('Record payment')}
          </Button>
        </form>
        <section className='mt-6 flex flex-col gap-2'>
          <h3 className='font-medium'>{t('Payment history')}</h3>
          {payments.isPending && <LoadingState />}
          {payments.isError && (
            <ErrorState
              onRetry={() => {
                void payments.refetch()
              }}
            />
          )}
          {payments.isSuccess && payments.data.items.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t('No payments recorded yet.')}
            </p>
          )}
          {payments.isSuccess && payments.data.items.length > 0 && (
            <ul className='flex flex-col gap-2 text-sm'>
              {payments.data.items.map((payment) => (
                <li
                  key={payment.id}
                  className='flex flex-col gap-2 rounded-md border p-3 break-words'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium tabular-nums'>
                      {formatCny(centsToMicro(payment.cny_amount_minor))}
                    </span>
                    <span className='tabular-nums'>
                      {formatCredit(payment.credit_micro)}
                    </span>
                    {payment.kind === 'reversal' && (
                      <Badge variant='outline'>{t('Reversal')}</Badge>
                    )}
                    {payment.reversal_id !== null && (
                      <Badge variant='secondary'>{t('Reversed')}</Badge>
                    )}
                  </div>
                  <span className='text-muted-foreground'>
                    {new Date(payment.occurred_at * 1000).toLocaleString(
                      locale,
                      { timeZone: 'Asia/Shanghai', hour12: false }
                    )}
                  </span>
                  {payment.note && <p>{payment.note}</p>}
                  {payment.kind === 'payment' &&
                    payment.reversal_id === null && (
                      <Button
                        className='min-h-11 self-start'
                        variant='outline'
                        aria-label={t('Reverse payment of {{amount}}', {
                          amount: formatCny(
                            centsToMicro(payment.cny_amount_minor)
                          ),
                        })}
                        onClick={() => setReversing(payment)}
                      >
                        {t('Reverse')}
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Dialog>
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(open) => {
          if (!open) {
            setReversing(null)
            setReason('')
          }
        }}
        title={t('Reverse this payment?')}
        desc={t(
          'The payment stays in the history and a reversal with the opposite amount is added.'
        )}
        confirmText={t('Reverse')}
        destructive
        disabled={reason.trim() === ''}
        isLoading={reverse.isPending}
        handleConfirm={() => {
          if (reversing) reverse.mutate(reversing)
        }}
      >
        <Field>
          <FieldLabel htmlFor='payment-reverse-reason'>
            {t('Reason')}
          </FieldLabel>
          <Textarea
            id='payment-reverse-reason'
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </>
  )
}
