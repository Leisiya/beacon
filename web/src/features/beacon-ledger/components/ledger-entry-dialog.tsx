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
import axios from 'axios'
import { useRef, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { FormNavigationGuard } from '@/features/system-settings/components/form-navigation-guard'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'

import { postLedger } from '../api'
import {
  ledgerFormSchema,
  ledgerInput,
  ledgerMoney,
  newLedgerForm,
  type LedgerFormValues,
} from '../lib/form'
import type { LedgerEntry, LedgerInput, LedgerKind } from '../types'
import { LedgerFormFields } from './ledger-form'

export function LedgerEntryDialog(props: {
  open: boolean
  kind: LedgerKind
  source?: LedgerEntry
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const verification = useSecureVerification()
  const form = useForm<LedgerFormValues>({
    resolver: zodResolver(ledgerFormSchema),
    defaultValues: {
      ...newLedgerForm(props.kind, props.source?.id),
      cny_per_unit:
        props.kind === 'refund' && props.source?.currency !== 'CNY' ? '' : '1',
    },
  })
  const [review, setReview] = useState<LedgerInput | null>(null)
  const [pending, setPending] = useState<LedgerInput | null>(null)
  const [working, setWorking] = useState(false)
  const inFlight = useRef(false)
  const mutation = useMutation({
    mutationFn: (request: { entry: LedgerInput; proof: string }) =>
      postLedger(request.entry, request.proof),
    retry: false,
    meta: { errorToast: false },
  })
  const submit = async (): Promise<void> => {
    if (!review || inFlight.current) return
    inFlight.current = true
    setWorking(true)
    let sent = false
    try {
      const proof = await verification.requestVerification({
        scope: 'beacon.ledger.post',
        context: { entry: review },
        title: t('Verify ledger entry'),
        description: t(
          'This authorization applies only to the reviewed entry.'
        ),
      })
      if (!proof) return
      sent = true
      const result = await mutation.mutateAsync({
        entry: review,
        proof: proof.proof_token,
      })
      setPending(null)
      setReview(null)
      toast.success(
        t('Ledger entry confirmed: #{{id}}', { id: result.entry.id })
      )
      await client.invalidateQueries({ queryKey: ['beacon-ledger'] })
      props.onComplete()
    } catch (error) {
      const cause = error instanceof AuthOperationError ? error.cause : error
      // An unknown transport result must retain the exact body and key.
      // A definitive 4xx means no new entry was committed by this request.
      const uncertain =
        sent &&
        (!axios.isAxiosError(cause) ||
          !cause.response ||
          cause.response.status >= 500)
      if (pending || uncertain) setPending(review)
      else {
        setPending(null)
        setReview(null)
      }
      handleServerError(error)
    } finally {
      setWorking(false)
      inFlight.current = false
    }
  }
  return (
    <>
      <FormNavigationGuard
        when={!!pending || working}
        message={t(
          'The result is uncertain. Retry this exact entry to check or finish it safely; do not create a replacement or refresh this page.'
        )}
      />
      <Dialog
        open={props.open && !review && !verification.isActive}
        onOpenChange={(open) => {
          if (!working) props.onOpenChange(open)
        }}
        title={t('Record ledger entry')}
        description={t(
          'Record confirmed external payments only. This page does not transfer money.'
        )}
        footer={
          <Button
            className='min-h-11'
            type='submit'
            form='ledger-entry-form'
            disabled={working}
          >
            {t('Review entry')}
          </Button>
        }
      >
        <FormProvider {...form}>
          <form
            id='ledger-entry-form'
            onSubmit={form.handleSubmit((values) =>
              setReview(pending ?? ledgerInput(values, crypto.randomUUID()))
            )}
          >
            <LedgerFormFields locked={!!pending} correction={!!props.source} />
          </form>
        </FormProvider>
        <p className='text-muted-foreground mt-4 text-sm'>
          {t(
            'Refunds return the full original amount and remove the original quota. Reversals negate the original entry; they do not make a bank refund. Original records remain available.'
          )}
        </p>
      </Dialog>
      <ConfirmDialog
        className='max-h-[90dvh] overflow-y-auto'
        open={props.open && !!review && !verification.isActive}
        onOpenChange={(open) => {
          if (!open && !working && !pending) setReview(null)
        }}
        title={t('Confirm ledger entry')}
        desc={
          <div className='flex flex-col gap-3'>
            <p>
              {t(
                'Check the customer, amount, quota and reference before confirming. Entries cannot be edited after posting.'
              )}
            </p>
            {review && (
              <dl className='grid grid-cols-1 gap-2 text-sm'>
                <div>
                  {t('Entry type')}:{' '}
                  {t(
                    {
                      receipt: 'Manual receipt',
                      gift: 'Gift quota',
                      refund: 'Full refund',
                      reversal: 'Reverse entry',
                    }[review.kind]
                  )}
                </div>
                <div>
                  {t('Customer ID')}:{' '}
                  {review.user_id || props.source?.user_id || '—'} /{' '}
                  {t('Original entry ID')}: {review.corrects_id || '—'}
                </div>
                {props.source && (
                  <div>
                    {t('Original currency amount')}:{' '}
                    {ledgerMoney(
                      props.source.original_amount_minor,
                      props.source.currency || 'CNY'
                    )}{' '}
                    / {t('Quota change (units)')}: {-props.source.quota_delta}
                  </div>
                )}
                <div>
                  {t('Original currency amount')}: {review.currency}{' '}
                  {review.kind === 'gift'
                    ? 'CNY 0.00'
                    : review.amount || t('Derived from original entry')}
                </div>
                <div>
                  {t('Balance to credit')}:{' '}
                  {review.quota
                    ? t('{{balance}} ({{quota}} quota units)', {
                        balance: formatQuotaWithCurrency(review.quota, {
                          abbreviate: false,
                          locale,
                        }),
                        quota: formatNumber(review.quota, locale),
                      })
                    : t('Derived from original entry')}
                </div>
                {review.cny_per_unit && (
                  <div>
                    {t('CNY per original currency unit')}: {review.cny_per_unit}{' '}
                    / {review.fx_source}
                  </div>
                )}
                <div className='break-all'>
                  {review.payment_method} {review.payment_reference}
                </div>
                <div className='break-words'>{review.note}</div>
                <div>
                  {t('Occurred at (Asia/Shanghai)')}:{' '}
                  {new Date(review.occurred_at * 1000 + 8 * 3600000)
                    .toISOString()
                    .slice(0, 16)
                    .replace('T', ' ')}
                </div>
              </dl>
            )}
            {pending && (
              <Alert>
                <AlertDescription>
                  {t(
                    'The result is uncertain. Retry this exact entry to check or finish it safely; do not create a replacement or refresh this page.'
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        }
        isLoading={working}
        confirmText={pending ? t('Retry same entry') : t('Verify and post')}
        handleConfirm={() => {
          void submit()
        }}
      />
      <SecureVerificationDialog {...verification.dialogProps} />
    </>
  )
}
