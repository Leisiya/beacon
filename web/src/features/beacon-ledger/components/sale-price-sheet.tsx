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

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ModelPricingPanel } from '@/features/model-pricing/model-pricing-panel'

// The models page pricing editor, opened from the sale price table so a price
// can be changed next to its cost.
export function SalePriceSheet(props: {
  modelName: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [dirty, setDirty] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const close = (open: boolean) => {
    if (!open && dirty) {
      setConfirm(true)
      return
    }
    props.onOpenChange(open)
  }
  return (
    <>
      <Sheet open={!!props.modelName} onOpenChange={close}>
        <SheetContent
          className={sideDrawerContentClassName('sm:max-w-[1280px]')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle className='pr-6 break-all'>
              {props.modelName}
            </SheetTitle>
            <SheetDescription>
              {t(
                'Prices are per 1M tokens, in the pricing currency chosen below. A change applies to every customer at once.'
              )}
            </SheetDescription>
          </SheetHeader>
          {props.modelName && (
            <div className='flex min-h-0 flex-1 flex-col'>
              <ModelPricingPanel
                key={props.modelName}
                modelName={props.modelName}
                onDirtyChange={setDirty}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Discard unsaved changes?')}
        desc={t('Your changes have not been saved.')}
        confirmText={t('Discard changes')}
        handleConfirm={() => {
          setConfirm(false)
          setDirty(false)
          props.onOpenChange(false)
        }}
      />
    </>
  )
}
