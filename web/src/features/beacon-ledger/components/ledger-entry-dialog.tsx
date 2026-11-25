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

import {
  getCostSources,
  postExpense,
  postLedger,
  postUpstreamPayment,
} from '../api'
import {
  entryKindLabels,
  entryRequest,
  ledgerFormSchema,
  ledgerMoney,
  newLedgerForm,
  newRequestKey,
  type EntryRequest,
  type LedgerFormValues,
} from '../lib/form'
import type { EntryKind, LedgerEntry } from '../types'
import { LedgerFormFields } from './ledger-form'

function shanghaiTime(seconds: number): string {
  return new Date(seconds * 1000 + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
}

// What the operator confirms: every detail that will be recorded.
function ReviewDetails(props: { review: EntryRequest; source?: LedgerEntry }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const upstreams = useQuery({
    queryKey: ['beacon-ledger', 'cost-sources'],
    queryFn: getCostSources,
    enabled: props.review.source === 'upstream',
    retry: false,
  })
  const review = props.review
  if (review.source === 'upstream') {
    const upstream = upstreams.data?.sources.find(
      (item) => item.id === review.input.channel_id
    )
    return (
      <dl className='grid grid-cols-1 gap-2 text-sm'>
        <div>
          {t('Entry type')}: {t(entryKindLabels.upstream)}
        </div>
        <div>
          {t('Upstream')}: {upstream?.name ?? '—'} #{review.input.channel_id}
        </div>
        <div>
          {t('CNY paid')}: CNY {review.input.amount}
        </div>
        <div>
          {t('Credit received (upstream $)')}: ${review.input.credit}
        </div>
        <div>
          {t('Occurred at (Asia/Shanghai)')}:{' '}
          {shanghaiTime(review.input.occurred_at)}
        </div>
        {review.input.note && (
          <div className='break-words'>{review.input.note}</div>
        )}
      </dl>
    )
  }
  if (review.source === 'expense') {
    return (
      <dl className='grid grid-cols-1 gap-2 text-sm'>
        <div>
          {t('Entry type')}:{' '}
          {t(entryKindLabels[review.input.category as EntryKind])}
        </div>
        <div>
          {t('Amount (CNY)')}: CNY {review.input.amount}
        </div>
        <div>
          {t('Occurred at (Asia/Shanghai)')}:{' '}
          {shanghaiTime(review.input.occurred_at)}
        </div>
        {review.input.note && (
          <div className='break-words'>{review.input.note}</div>
        )}
      </dl>
    )
  }
  const entry = review.input
  return (
    <dl className='grid grid-cols-1 gap-2 text-sm'>
      <div>
        {t('Entry type')}: {t(entryKindLabels[entry.kind])}
      </div>
      <div>
        {t('Customer ID')}: {entry.user_id || props.source?.user_id || '—'} /{' '}
        {t('Original entry ID')}: {entry.corrects_id || '—'}
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
        {t('Original currency amount')}: {entry.currency}{' '}
        {entry.kind === 'gift'
          ? 'CNY 0.00'
          : entry.amount || t('Derived from original entry')}
      </div>
      <div>
        {t(
          entry.kind === 'refund' ? 'Balance to take back' : 'Balance to credit'
        )}
        :{' '}
        {entry.kind === 'reversal'
          ? t('Derived from original entry')
          : t('{{balance}} ({{quota}} quota units)', {
              balance: formatQuotaWithCurrency(entry.quota, {
                abbreviate: false,
                locale,
              }),
              quota: formatNumber(entry.quota, locale),
            })}
      </div>
      {entry.cny_per_unit && entry.cny_per_unit !== '1' && (
        <div>
          {t('CNY per original currency unit')}: {entry.cny_per_unit}
        </div>
      )}
      <div className='break-all'>
        {entry.payment_method} {entry.payment_reference}
      </div>
      <div>
        {t('Occurred at (Asia/Shanghai)')}: {shanghaiTime(entry.occurred_at)}
      </div>
    </dl>
  )
}

export function LedgerEntryDialog(props: {
  open: boolean
  kind: EntryKind
  source?: LedgerEntry
  // Preselects the upstream of a top-up.
  channelId?: number
  // Preselects the customer of a refund, and the money to pay back.
  userId?: number
  amount?: string
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const verification = useSecureVerification()
  const form = useForm<LedgerFormValues>({
    resolver: zodResolver(ledgerFormSchema),
    defaultValues: {
      ...newLedgerForm(props.kind, props.source?.id, props.userId),
      channel_id: props.channelId ? String(props.channelId) : '',
      amount: props.amount ?? '',
    },
  })
  const [review, setReview] = useState<EntryRequest | null>(null)
  const [pending, setPending] = useState<EntryRequest | null>(null)
  const [working, setWorking] = useState(false)
  const inFlight = useRef(false)
  // Resolves to the success message. Customer entries change a wallet and
  // need a proof; money paid out does not.
  const mutation = useMutation({
    mutationFn: async (request: {
      entry: EntryRequest
      proof: string
    }): Promise<string> => {
      const entry = request.entry
      if (entry.source === 'customer') {
        const result = await postLedger(entry.input, request.proof)
        return t('Ledger entry confirmed: #{{id}}', { id: result.entry.id })
      }
      if (entry.source === 'upstream') await postUpstreamPayment(entry.input)
      else await postExpense(entry.input)
      return t('Entry recorded')
    },
    retry: false,
    meta: { errorToast: false },
  })
  const submit = async (): Promise<void> => {
    if (!review || inFlight.current) return
    inFlight.current = true
    setWorking(true)
    let sent = false
    try {
      let proof = ''
      if (review.source === 'customer') {
        const verified = await verification.requestVerification({
          scope: 'beacon.ledger.post',
          context: { entry: review.input },
          title: t('Verify ledger entry'),
          description: t(
            'This authorization applies only to the reviewed entry.'
          ),
        })
        if (!verified) return
        proof = verified.proof_token
      }
      sent = true
      const message = await mutation.mutateAsync({ entry: review, proof })
      setPending(null)
      setReview(null)
      toast.success(message)
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
  let confirmText = t('Confirm and record')
  if (pending) confirmText = t('Retry same entry')
  else if (review?.source === 'customer') confirmText = t('Verify and post')
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
        title={t('New entry')}
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
              setReview(pending ?? entryRequest(values, newRequestKey()))
            )}
          >
            <LedgerFormFields locked={!!pending} correction={!!props.source} />
          </form>
        </FormProvider>
        {props.source && (
          <p className='text-muted-foreground mt-4 text-sm'>
            {t(
              'The entry stays in the books and a reversal with the opposite amount is added.'
            )}
          </p>
        )}
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
              {review?.source === 'customer'
                ? t(
                    'Check the customer, amount, quota and reference before confirming. Entries cannot be edited after posting.'
                  )
                : t(
                    'Check the amount and date before confirming. Entries cannot be edited; a wrong one can be reversed.'
                  )}
            </p>
            {review && <ReviewDetails review={review} source={props.source} />}
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
        confirmText={confirmText}
        handleConfirm={() => {
          void submit()
        }}
      />
      <SecureVerificationDialog {...verification.dialogProps} />
    </>
  )
}
