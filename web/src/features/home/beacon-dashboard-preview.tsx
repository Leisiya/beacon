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
*/
import { Link } from '@tanstack/react-router'

import { BeaconArtwork } from '@/components/beacon-artwork'
import { Footer } from '@/components/layout/components/footer'
import { useAuthStore } from '@/stores/auth-store'

import { BeaconHeader } from './beacon-home'

const previewCards = [
  { title: '我的余额', detail: '登录后接入个人余额' },
  { title: '本月消费', detail: '按实际调用记录统计' },
  { title: 'API Key', detail: '在真实控制台中管理' },
]

export function BeaconDashboardPreview() {
  const { auth } = useAuthStore()
  return (
    <div className='beacon-page beacon-preview'>
      <BeaconHeader isAuthenticated={!!auth.user} />
      <div className='beacon-preview-banner'>
        控制台视觉样板 · 此页没有连接账务数据，不代表真实余额或经营结果
      </div>
      <main className='beacon-preview-shell'>
        <aside className='beacon-preview-side' aria-label='样板导航'>
          <h2>控制台</h2>
          <span className='active'>总览</span>
          <Link to='/keys'>API Key</Link>
          <Link to='/pricing'>模型与价格</Link>
          <Link to='/docs'>API 文档</Link>
          <Link to='/wallet'>充值与余额</Link>
        </aside>
        <div className='beacon-preview-main'>
          <div className='beacon-preview-intro'>
            <div>
              <p className='beacon-preview-eyebrow'>BEACON / OVERVIEW</p>
              <h1>总览</h1>
              <p className='beacon-preview-subtitle'>
                清楚查看自己的额度、用量与调用记录。
              </p>
            </div>
            <div className='beacon-preview-scene' aria-hidden='true'>
              <BeaconArtwork decorative />
            </div>
          </div>
          <div className='beacon-preview-grid'>
            {previewCards.map((card) => (
              <section className='beacon-preview-card' key={card.title}>
                <h2>{card.title}</h2>
                <p className='beacon-preview-value empty'>暂无数据</p>
                <p className='beacon-preview-subtitle'>{card.detail}</p>
              </section>
            ))}
          </div>
          <div className='beacon-preview-columns beacon-preview-wide'>
            <section className='beacon-preview-card'>
              <h2>使用趋势</h2>
              <div className='beacon-preview-placeholder'>
                登录并产生调用后，这里展示真实用量趋势。
              </div>
            </section>
            <section className='beacon-preview-card'>
              <h2>快速开始</h2>
              <p>
                在真实控制台创建 API Key，查看已配置模型，再按文档接入应用。
              </p>
              <Link
                className='beacon-text-link'
                to={auth.user ? '/dashboard' : '/sign-in'}
              >
                {auth.user ? '进入真实控制台 →' : '登录后使用 →'}
              </Link>
            </section>
          </div>
          <section className='beacon-preview-card beacon-preview-wide'>
            <h2>最近调用</h2>
            <div className='beacon-preview-table-wrap'>
              <table className='beacon-preview-table'>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模型</th>
                    <th>用量</th>
                    <th>扣费</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={5}>暂无调用记录。样板页不展示模拟交易。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
