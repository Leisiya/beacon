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

// Customer charges are stored in quota units; convert them to millionths of
// the site's display unit with the server's quota-per-unit.
export function quotaToMicro(quota: string, quotaPerUnit: number): string {
  const perUnit = BigInt(Math.round(quotaPerUnit))
  if (perUnit <= 0n) return '0'
  return String((BigInt(quota) * 1000000n) / perUnit)
}

const shanghaiOffsetMs = 8 * 3600000

export function toShanghaiInput(seconds: number): string {
  return new Date(seconds * 1000 + shanghaiOffsetMs).toISOString().slice(0, 16)
}

export function fromShanghaiInput(value: string): number {
  return Math.floor(new Date(`${value}:00+08:00`).getTime() / 1000)
}
