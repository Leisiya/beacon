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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { getCostSources, postCostSync } from '../api'
import type { CostSource } from '../types'
import { UpstreamRateDialog } from './upstream-rate-dialog'

export function UpstreamSources() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<CostSource | null>(null)
  const sources = useQuery({
    queryKey: ['beacon-ledger', 'cost-sources'],
    queryFn: getCostSources,
    retry: false,
  })
  const sync = useMutation({
    mutationFn: postCostSync,
    onSuccess: () => {
      toast.success(t('Upstream sync finished'))
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
    },
    onError: (error) => handleServerError(error),
  })
  const time = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString(locale, {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    })
  const syncText = (source: CostSource) => {
    if (source.rates.length === 0) return t('Not synced: no rate')
    if (!source.sync) return t('Waiting for the first sync')
    if (source.sync.last_error) {
      return t('Failed: {{error}}', { error: source.sync.last_error })
    }
    return t('Synced {{time}} · {{count}} new', {
      time: time(source.sync.last_success_at),
      count: formatNumber(source.sync.inserted, locale),
    })
  }
  return (
    <TitledCard
      title={<h2>{t('Upstream rates and sync')}</h2>}
      description={t('Root only · supplier keys are never shown')}
      action={
        <Button
          className='min-h-11'
          variant='outline'
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          {sync.isPending ? t('Syncing…') : t('Sync now')}
        </Button>
      }
      disableHoverEffect
    >
      <div className='flex min-w-0 flex-col gap-4'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Channels with a rate are synced every 5 minutes. Per-request deductions are read from upstreams built on New API; other upstreams report a sync error.'
          )}
        </p>
        {sources.isPending && <LoadingState />}
        {sources.isError && (
          <ErrorState
            onRetry={() => {
              void sources.refetch()
            }}
          />
        )}
        {sources.isSuccess && sources.data.sources.length === 0 && (
          <EmptyState
            title={t('No channels')}
            description={t('Create a channel first, then set its rate here.')}
          />
        )}
        {sources.isSuccess && sources.data.sources.length > 0 && (
          <StaticDataTable
            className='overflow-x-auto'
            tableProps={{ withContainer: false }}
            data={sources.data.sources}
            getRowKey={(source) => source.id}
            containerProps={{
              role: 'region',
              'aria-label': t('Upstream rates and sync'),
              tabIndex: 0,
            }}
            tableClassName='min-w-[720px]'
            columns={[
              {
                id: 'channel',
                header: t('Channel'),
                cell: (source) => (
                  <div className='flex flex-col'>
                    <span className='font-medium'>
                      #{source.id} {source.name}
                    </span>
                    <span className='text-muted-foreground text-xs break-all'>
                      {source.base_url || '—'}
                    </span>
                  </div>
                ),
              },
              {
                id: 'rate',
                header: t('Current rate'),
                cell: (source) => {
                  const current = source.rates[0]
                  if (!current) return t('Not set')
                  return (
                    <div className='flex flex-col'>
                      <span className='tabular-nums'>
                        {t('¥{{value}} per upstream $1', {
                          value: current.cny_per_unit,
                        })}
                      </span>
                      <span className='text-muted-foreground text-xs'>
                        {t('From {{time}}', {
                          time: time(current.effective_at),
                        })}
                      </span>
                    </div>
                  )
                },
              },
              {
                id: 'ratio',
                header: t('Upstream group ratio'),
                cell: (source) =>
                  source.observation ? (
                    <div className='flex flex-col'>
                      <span className='tabular-nums'>
                        {source.observation.group_ratio || '—'}
                      </span>
                      <span className='text-muted-foreground text-xs break-all'>
                        {source.observation.upstream_group} ·{' '}
                        {time(source.observation.occurred_at)}
                      </span>
                    </div>
                  ) : (
                    '—'
                  ),
              },
              {
                id: 'sync',
                header: t('Sync'),
                cell: (source) => (
                  <span className='text-sm break-words'>
                    {syncText(source)}
                  </span>
                ),
              },
              {
                id: 'actions',
                header: t('Actions'),
                cell: (source) => (
                  <Button
                    className='min-h-11'
                    variant='outline'
                    onClick={() => setEditing(source)}
                  >
                    {source.rates.length > 0 ? t('Change rate') : t('Set rate')}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </div>
      <UpstreamRateDialog
        source={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
    </TitledCard>
  )
}
