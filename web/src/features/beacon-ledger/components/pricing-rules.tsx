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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { getPricingReport, postPricingEvaluate, postPricingRule } from '../api'
import type { PriceProposal, PricingRuleInput } from '../types'
import { ModelPricingTable } from './model-pricing-table'
import { PriceProposals } from './price-proposals'
import { PriceRuleForm } from './price-rule-form'
import { ReferencePriceCard } from './reference-price-card'

export function PricingRules() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const report = useQuery({
    queryKey: ['beacon-ledger', 'pricing'],
    queryFn: getPricingReport,
    retry: false,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
  }
  const saveDefault = useMutation({
    mutationFn: (rule: PricingRuleInput) => postPricingRule(rule),
    onSuccess: () => {
      toast.success(t('Price rule saved'))
      refresh()
    },
    onError: (error) => handleServerError(error),
  })
  const evaluate = useMutation({
    mutationFn: postPricingEvaluate,
    onSuccess: () => {
      toast.success(t('Price rules recalculated'))
      refresh()
    },
    onError: (error) => handleServerError(error),
  })
  const statusText: Record<PriceProposal['status'], string> = {
    pending: t('Pending'),
    applied: t('Applied'),
    dismissed: t('Dismissed'),
    superseded: t('Superseded'),
    failed: t('Failed'),
  }
  if (report.isPending) return <LoadingState />
  if (report.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void report.refetch()
        }}
      />
    )
  }
  const data = report.data
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <ReferencePriceCard cnyPerUnit={data.reference_cny_per_unit} />
      {/* Pending changes also show as a badge in the model table. */}
      {data.proposals.length > 0 && (
        <PriceProposals proposals={data.proposals} />
      )}
      <ModelPricingTable models={data.models} proposals={data.proposals} />
      <TitledCard
        title={<h2>{t('Default price rule')}</h2>}
        description={t(
          'How sale prices follow supplier prices. Each model is compared at the lowest group ratio it is sold at.'
        )}
        action={
          <Button
            className='min-h-11'
            variant='outline'
            disabled={evaluate.isPending}
            onClick={() => evaluate.mutate()}
          >
            {t('Recalculate now')}
          </Button>
        }
        disableHoverEffect
      >
        <div className='flex min-w-0 flex-col gap-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Rules run after every upstream cost sync. A change scales every price of the model’s billing expression by one factor and takes effect for all customers at once.'
            )}
          </p>
          <PriceRuleForm
            idPrefix='default-rule'
            rule={data.default_rule}
            modelName=''
            submitLabel={t('Save default rule')}
            pending={saveDefault.isPending}
            onSubmit={(rule) => saveDefault.mutate(rule)}
          />
        </div>
      </TitledCard>
      {data.history.length > 0 && (
        <TitledCard
          title={<h2>{t('Price change history')}</h2>}
          disableHoverEffect
        >
          <ul className='flex flex-col gap-2 text-sm'>
            {data.history.map((proposal) => (
              <li
                key={proposal.id}
                className='flex flex-wrap items-center gap-2 border-b pb-2 last:border-b-0'
              >
                <span className='font-medium break-all'>
                  {proposal.model_name}
                </span>
                <Badge variant='outline'>{statusText[proposal.status]}</Badge>
                {proposal.automatic && (
                  <Badge variant='secondary'>{t('Automatic')}</Badge>
                )}
                <span className='tabular-nums'>×{proposal.factor}</span>
                <span className='text-muted-foreground'>
                  {new Date(
                    (proposal.decided_at || proposal.created_at) * 1000
                  ).toLocaleString(locale, {
                    timeZone: 'Asia/Shanghai',
                    hour12: false,
                  })}
                </span>
                {proposal.error && (
                  <span className='text-destructive break-all'>
                    {proposal.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </TitledCard>
      )}
    </div>
  )
}
