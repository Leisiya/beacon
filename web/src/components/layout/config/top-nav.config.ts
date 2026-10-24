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
import type { TopNavLink } from '../types'

/**
 * Default top navigation links
 *
 * In practice, navigation links are dynamically fetched from backend.
 * Priority: Backend dynamic links > Provided navLinks > defaultTopNavLinks
 *
 * Beacon provides a small fallback set when the backend has no configured
 * links. Backend links still take priority in the shared headers.
 */
export const defaultTopNavLinks: TopNavLink[] = [
  { title: '模型广场', href: '/pricing' },
  { title: 'API 文档', href: '/docs' },
  { title: '关于', href: '/about' },
]

export function resolveBeaconTopNavLinks(links: TopNavLink[]): TopNavLink[] {
  return links.map((link) =>
    /^https?:\/\/docs\.newapi\.(ai|pro)(\/|$)/.test(link.href)
      ? { ...link, href: '/docs', external: false }
      : link
  )
}
