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
import { Link } from '@tanstack/react-router'
import { ArrowRight, ExternalLink, KeyRound, Layers3, Send } from 'lucide-react'

import { BeaconArtwork } from '@/components/beacon-artwork'
import { PublicLayout } from '@/components/layout'

const requestExample = `curl https://your-beacon-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-enabled-model",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`

export function BeaconDocs() {
  return (
    <PublicLayout showMainContainer={false}>
      <main className='beacon-docs mx-auto max-w-[1260px] px-5 pt-28 pb-24 sm:px-8'>
        <div className='beacon-docs-hero'>
          <div>
            <p className='beacon-docs-eyebrow'>BEACON / DOCUMENTATION</p>
            <h1>API 文档</h1>
            <p>一个清晰的入口，连接你已开通的模型。按下面三步完成首次请求。</p>
          </div>
          <BeaconArtwork decorative />
        </div>

        <div className='beacon-docs-grid'>
          <nav aria-label='文档目录' className='beacon-docs-nav'>
            <a href='#quick-start'>快速开始</a>
            <a href='#request-example'>请求示例</a>
            <a href='#more-docs'>完整参考</a>
          </nav>

          <div className='beacon-docs-content'>
            <section id='quick-start'>
              <p className='beacon-docs-eyebrow'>01 / START HERE</p>
              <h2>快速开始</h2>
              <div className='beacon-docs-steps'>
                <div>
                  <KeyRound size={22} aria-hidden='true' />
                  <h3>创建 API Key</h3>
                  <p>登录控制台创建密钥，并妥善保存。密钥只在请求头中使用。</p>
                  <Link to='/keys'>
                    前往密钥管理 <ArrowRight size={15} />
                  </Link>
                </div>
                <div>
                  <Layers3 size={22} aria-hidden='true' />
                  <h3>确认可用模型</h3>
                  <p>在模型广场查看本站已配置的模型，使用对应的模型名称。</p>
                  <Link to='/pricing'>
                    查看模型广场 <ArrowRight size={15} />
                  </Link>
                </div>
                <div>
                  <Send size={22} aria-hidden='true' />
                  <h3>发送请求</h3>
                  <p>将站点域名、API Key 和模型名称替换为自己的实际值。</p>
                </div>
              </div>
            </section>

            <section id='request-example'>
              <p className='beacon-docs-eyebrow'>02 / REQUEST</p>
              <h2>请求示例</h2>
              <p>
                下面展示 OpenAI
                兼容的聊天请求格式。实际可用能力取决于本站配置的渠道和模型。
              </p>
              <pre className='beacon-docs-code'>
                <code>{requestExample}</code>
              </pre>
            </section>

            <section id='more-docs'>
              <p className='beacon-docs-eyebrow'>03 / REFERENCE</p>
              <h2>完整参考</h2>
              <p>
                本站先提供统一风格的接入指引。进阶接口、参数和错误码仍以 New API
                上游文档为准。
              </p>
              <a
                href='https://docs.newapi.ai'
                target='_blank'
                rel='noopener noreferrer'
              >
                打开上游完整文档 <ExternalLink size={16} />
              </a>
            </section>
          </div>
        </div>
      </main>
    </PublicLayout>
  )
}
