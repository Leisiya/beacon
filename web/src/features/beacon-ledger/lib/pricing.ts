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
import { useTranslation } from 'react-i18next'

import type { PriceLine } from '../types'

export function bpToPercent(bp: number): string {
  return String(bp / 100)
}

export function percentToBp(value: string): number {
  return Math.round(Number(value) * 100)
}

export function formatBp(bp: number | null, locale: Intl.LocalesArgument) {
  if (bp == null) return '—'
  return `${Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bp / 100)}%`
}

// Per-token prices are small; four decimals keep cache prices readable.
export function formatCny(value: number, locale: Intl.LocalesArgument) {
  return `¥${Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)}`
}

export function usePriceLineLabel(): (line: PriceLine) => string {
  const { t } = useTranslation()
  const kinds: Record<string, string> = {
    input: t('Input'),
    output: t('Output'),
    cache_read: t('Cache read'),
    cache_write: t('Cache write'),
    cache_write_1h: t('Cache write (1 hour)'),
    image_input: t('Image input'),
    audio_input: t('Audio input'),
    audio_output: t('Audio output'),
    image_output: t('Image output'),
    request: t('Per request'),
  }
  return (line) => {
    const label = kinds[line.kind] ?? line.kind
    if (line.context <= 1000) return label
    return t('{{label}} · at {{size}}K context', {
      label,
      size: line.context / 1000,
    })
  }
}
