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

// Upstream cost amounts arrive as decimal strings in millionths so totals stay
// exact beyond JavaScript's safe integer range.
export function formatMicro(value: string, digits: number): string {
  const micro = BigInt(value)
  const negative = micro < 0n
  const absolute = negative ? -micro : micro
  const step = 10n ** BigInt(6 - digits)
  const rounded = (absolute + step / 2n) / step
  const scale = 10n ** BigInt(digits)
  const whole = String(rounded / scale)
  const fraction = String(rounded % scale).padStart(digits, '0')
  const sign = negative && rounded > 0n ? '-' : ''
  return digits > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

// Profit can be negative, so the sign goes before the currency symbol.
export function formatMicroCny(value: string, digits: number): string {
  const text = formatMicro(value, digits)
  return text.startsWith('-') ? `-¥${text.slice(1)}` : `¥${text}`
}

export function addMicro(...values: string[]): string {
  return String(values.reduce((sum, value) => sum + BigInt(value), 0n))
}

const shanghaiOffsetMs = 8 * 3600000

export function toShanghaiInput(seconds: number): string {
  return new Date(seconds * 1000 + shanghaiOffsetMs).toISOString().slice(0, 16)
}

export function fromShanghaiInput(value: string): number {
  return Math.floor(new Date(`${value}:00+08:00`).getTime() / 1000)
}
