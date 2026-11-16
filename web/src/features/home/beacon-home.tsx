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
import {
  ArrowRight,
  ChevronDown,
  Layers3,
  Menu,
  Route,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useState } from 'react'

import { BeaconArtwork } from '@/components/beacon-artwork'
import { BeaconMark } from '@/components/beacon-mark'
import { Footer } from '@/components/layout/components/footer'
import { useTheme } from '@/context/theme-provider'

import './beacon.css'

type ThemeChoice = 'light' | 'dark' | 'system'

export function BeaconHeader({
  isAuthenticated = false,
}: {
  isAuthenticated?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const closeMenu = () => setMenuOpen(false)
  return (
    <header className='beacon-header'>
      <div className='beacon-container beacon-header-inner'>
        <Link
          to='/'
          className='beacon-brand'
          aria-label='Beacon 首页'
          onClick={closeMenu}
        >
          <BeaconMark />
          <span>Beacon</span>
        </Link>
        <button
          className='beacon-mobile-toggle'
          type='button'
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <nav
          className={`beacon-nav${menuOpen ? ' is-open' : ''}`}
          aria-label='主要导航'
        >
          <Link to='/pricing' onClick={closeMenu}>
            模型广场
          </Link>
          <Link to='/docs' onClick={closeMenu}>
            API 文档
          </Link>
          <Link to='/about' onClick={closeMenu}>
            关于
          </Link>
          <div className='beacon-nav-actions'>
            <label className='beacon-theme-label'>
              主题
              <span className='beacon-theme-select'>
                <select
                  aria-label='主题'
                  value={theme}
                  onChange={(event) =>
                    setTheme(event.target.value as ThemeChoice)
                  }
                >
                  <option value='system'>跟随系统</option>
                  <option value='light'>浅色</option>
                  <option value='dark'>深色</option>
                </select>
                <ChevronDown aria-hidden='true' size={16} strokeWidth={1.8} />
              </span>
            </label>
            {!isAuthenticated && (
              <Link
                className='beacon-nav-login'
                to='/sign-in'
                onClick={closeMenu}
              >
                登录
              </Link>
            )}
            <Link
              className='beacon-button beacon-button-primary beacon-nav-start'
              to={isAuthenticated ? '/dashboard' : '/sign-up'}
              onClick={closeMenu}
            >
              {isAuthenticated ? '进入控制台' : '开始使用'}
            </Link>
          </div>
        </nav>
      </div>
    </header>
  )
}

export function BeaconHome({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className='beacon-page'>
      <BeaconHeader isAuthenticated={isAuthenticated} />
      <main>
        <section className='beacon-hero beacon-container'>
          <div className='beacon-hero-copy'>
            <p className='beacon-eyebrow'>A BRIGHTER WAY TO AI</p>
            <h1>
              让强大的模型，
              <br />
              更简单地抵达你。
            </h1>
            <p className='beacon-hero-description'>
              一个接口，连接已配置的 AI 模型。
              <br />
              统一管理密钥、渠道和用量，让接入更从容。
            </p>
            <div className='beacon-hero-actions'>
              <Link
                className='beacon-button beacon-button-primary'
                to={isAuthenticated ? '/dashboard' : '/sign-up'}
              >
                {isAuthenticated ? '进入控制台' : '开始使用'}{' '}
                <ArrowRight size={17} />
              </Link>
              <Link
                className='beacon-button beacon-button-secondary'
                to='/pricing'
              >
                查看模型
              </Link>
            </div>
            <p className='beacon-local-note'>
              当前为本地开发版本 · 模型及价格以后台实际配置为准
            </p>
          </div>
          <div className='beacon-hero-art'>
            <BeaconArtwork className='beacon-hero-illustration' />
            <span className='beacon-art-caption'>
              Beacon
              <br />
              Guide your AI journey.
            </span>
          </div>
        </section>
        <section
          className='beacon-benefits beacon-container'
          aria-label='服务能力'
        >
          <div>
            <Layers3 size={26} strokeWidth={1.8} />
            <strong>多模型接入</strong>
            <span>在一个入口管理已配置的模型</span>
          </div>
          <div>
            <Route size={26} strokeWidth={1.8} />
            <strong>渠道配置</strong>
            <span>通过后台维护上游渠道</span>
          </div>
          <div>
            <ShieldCheck size={26} strokeWidth={1.8} />
            <strong>用量可查</strong>
            <span>查看密钥、调用日志与余额</span>
          </div>
        </section>
        <section className='beacon-next beacon-container'>
          <div>
            <p className='beacon-eyebrow'>START WITH BEACON</p>
            <h2>从一个清晰的入口开始。</h2>
            <p>
              创建账户、配置 API
              Key，再按实际可用模型接入应用。本站仍在本地建设中，功能以控制台状态为准。
            </p>
          </div>
          <Link
            className='beacon-text-link'
            to={isAuthenticated ? '/dashboard' : '/sign-up'}
          >
            前往控制台 <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  )
}
