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
import { ExternalLink, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { buttonVariants } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { cn } from '@/lib/utils'

interface OfflineTopupCardProps {
  /** Administrator contact link, configured as the top-up link setting. */
  contactLink?: string
}

/**
 * Beacon takes payment offline: the customer pays the administrator directly
 * and the administrator credits the balance in the manual ledger.
 */
export function OfflineTopupCard(props: OfflineTopupCardProps) {
  const { t } = useTranslation()
  const steps = [
    t('Contact the administrator to confirm the amount and how to pay.'),
    t('Complete the payment offline.'),
    t(
      'After confirming the payment, the administrator credits your balance. It appears above once recorded.'
    ),
  ]
  return (
    <TitledCard
      title={t('Add Funds')}
      description={t('Offline payment · credited by the administrator')}
      icon={<WalletCards className='h-4 w-4' />}
      iconTone='success'
      disableHoverEffect
    >
      <div className='flex flex-col gap-4'>
        <ol className='text-muted-foreground list-decimal space-y-2 pl-5 text-sm leading-relaxed'>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {props.contactLink ? (
          <a
            href={props.contactLink}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(
              buttonVariants(),
              'min-h-11 w-full gap-2 sm:w-auto sm:self-start'
            )}
          >
            {t('Contact the administrator')}
            <ExternalLink className='h-4 w-4' aria-hidden='true' />
          </a>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Contact the administrator who opened your account to top up.'
            )}
          </p>
        )}
      </div>
    </TitledCard>
  )
}
