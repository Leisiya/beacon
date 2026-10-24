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
export function BeaconMark({
  className = 'beacon-mark',
}: {
  className?: string
}) {
  return (
    <svg className={className} viewBox='0 0 40 44' aria-hidden='true'>
      <path
        d='M3 39h34M7 36h26M12 33h16'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path
        d='m15 33 2-19h6l2 19Z'
        fill='var(--beacon-tower, #e8e7db)'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path d='M12 13h16v3H12zM16 7h8v6h-8zM19 3h2v4h-2z' fill='currentColor' />
      <path d='M18 18h4v5h-4z' fill='var(--beacon-glow, #ebc99e)' />
    </svg>
  )
}
