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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'

import { formatBp } from '../lib/pricing'
import type { ModelPricing, PriceProposal } from '../types'
import { ModelPricingDialog } from './model-pricing-dialog'

export function ModelPricingTable(props: {
  models: ModelPricing[]
  proposals: PriceProposal[]
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [selected, setSelected] = useState<string | null>(null)
  const pending = new Set(
    props.proposals.map((proposal) => proposal.model_name)
  )
  const statusText: Record<ModelPricing['status'], string> = {
    ok: t('Cost and sale compared'),
    legacy_pricing: t(
      'Ratio pricing: convert it to a billing expression first'
    ),
    no_cost: t('No supplier cost yet'),
    free_sale: t('Some usage is free to customers but charged upstream'),
    unsupported_expr: t('Expression shape cannot be adjusted automatically'),
  }
  return (
    <TitledCard
      title={<h2>{t('Models: cost and sale')}</h2>}
      description={t(
        'Lowest markup across usage types against the most expensive enabled supplier.'
      )}
      disableHoverEffect
    >
      {props.models.length === 0 ? (
        <EmptyState
          title={t('No models')}
          description={t('Models offered by enabled channels appear here.')}
        />
      ) : (
        <StaticDataTable
          className='overflow-x-auto'
          tableProps={{ withContainer: false }}
          data={props.models}
          getRowKey={(model) => model.model_name}
          containerProps={{
            role: 'region',
            'aria-label': t('Models: cost and sale'),
            tabIndex: 0,
          }}
          tableClassName='min-w-[680px]'
          columns={[
            {
              id: 'model',
              header: t('Model'),
              cell: (model) => (
                <div className='flex flex-col'>
                  <span className='font-medium break-all'>
                    {model.model_name}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {model.rule_overridden ? t('Own rule') : t('Default rule')}
                    {model.rule.mode === 'fixed' &&
                      ` · ${t('Fixed sale price')}`}
                  </span>
                </div>
              ),
            },
            {
              id: 'basis',
              header: t('Cost basis'),
              cell: (model) => {
                const basis = model.channels.find(
                  (channel) => channel.channel_id === model.basis_channel_id
                )
                if (!basis) return '—'
                return `#${basis.channel_id} ${basis.channel_name} · ×${basis.group_ratio}`
              },
            },
            {
              id: 'markup',
              header: t('Lowest markup'),
              cell: (model) => (
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='tabular-nums'>
                    {formatBp(model.current_markup_bp, locale)}
                  </span>
                  {model.below_minimum && (
                    <Badge variant='destructive'>{t('Below minimum')}</Badge>
                  )}
                </div>
              ),
            },
            {
              id: 'status',
              header: t('Status'),
              cell: (model) => (
                <div className='flex flex-col gap-1 text-sm'>
                  <span>{statusText[model.status]}</span>
                  {pending.has(model.model_name) && (
                    <Badge variant='warning'>{t('Price change pending')}</Badge>
                  )}
                </div>
              ),
            },
            {
              id: 'actions',
              header: t('Actions'),
              cell: (model) => (
                <Button
                  className='min-h-11'
                  variant='outline'
                  onClick={() => setSelected(model.model_name)}
                >
                  {t('Details and rule')}
                </Button>
              ),
            },
          ]}
        />
      )}
      <ModelPricingDialog
        model={
          props.models.find((model) => model.model_name === selected) ?? null
        }
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </TitledCard>
  )
}
