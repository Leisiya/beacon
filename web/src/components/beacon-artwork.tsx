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
type BeaconArtworkProps = {
  alt?: string
  className?: string
  decorative?: boolean
}

export function BeaconArtwork({
  alt = '灯塔照亮海岛，海面映出倒影',
  className = '',
  decorative = false,
}: BeaconArtworkProps) {
  return (
    <span
      className={`beacon-artwork ${className}`.trim()}
      aria-hidden={decorative || undefined}
    >
      <img
        className='beacon-artwork-day'
        src='/beacon/lighthouse-reference.png'
        alt={decorative ? '' : alt}
      />
      <img
        className='beacon-artwork-night'
        src='/beacon/lighthouse-night.png'
        alt={decorative ? '' : alt}
      />
    </span>
  )
}
