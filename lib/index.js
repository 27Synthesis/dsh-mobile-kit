// local-mobile-kit — 手机端实用工具箱：图片 / 压缩包 / 网页落盘 / 表格 / SQLite
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'local-mobile-kit'

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kit.py')
const OUT_DIR = '/sdcard/Download/DSH-Go'
const usage = Object.create(null)
const backend = { ok: null, python: '', pillow: '', openpyxl: '', checked: 0 }

function bump(tool) {
  usage[tool] = (usage[tool] ?? 0) + 1
}

function runKit(cmd, args, timeout = 120_000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('python3', [KIT], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, error: `无法启动 python3: ${error.message}` })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `spawn 失败: ${e.message}` })
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve({ ok: false, error: (err || out || 'python 无输出').trim().slice(0, 800) })
      }
    })
    child.stdin.end(JSON.stringify({ cmd, args }))
  })
}

async function call(tool, cmd, args) {
  bump(tool)
  const res = await runKit(cmd, args)
  if (!res.ok) return `❌ ${res.error}`
  return format(cmd, args, res.data)
}

function table(rows) {
  return rows.map((r) => r.map((c) => String(c ?? '')).join('\t')).join('\n')
}

function format(cmd, args, d) {
  if (cmd === 'img') {
    if (args.op === 'info' || !args.op) {
      const exif = d.exif ? `\nEXIF: ${Object.entries(d.exif).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''
      return `🖼 ${d.width}×${d.height} ${d.format ?? '?'} ${d.mode} ${d.human}\n路径 ${d.path}${d.frames > 1 ? `\n帧数 ${d.frames}` : ''}${exif}`
    }
    return `✅ ${d.format} 输出 ${d.out}\n${d.from ?? ''} → ${d.width}×${d.height}，${d.human}`
  }
  if (cmd === 'archive') {
    if (args.op === 'list') {
      const items = (d.items ?? []).map((i) => `${i.name}\t${Math.round(i.bytes / 1024)}KB`).join('\n')
      return `📦 ${d.path}\n条目 ${d.entries}｜解压后 ${d.uncompressed}｜压缩包 ${d.archive_bytes}\n${items}${d.truncated ? '\n…仅显示前 200 条' : ''}`
    }
    if (args.op === 'extract') return `✅ 解压 ${d.files} 个文件到 ${d.out}`
    return `✅ 打包 ${d.entries} 个文件 → ${d.out}（${d.human}）`
  }
  if (cmd === 'sheet') {
    if (args.op === 'to_csv') return `✅ ${d.sheet} → ${d.out}（${d.rows} 行）`
    if (args.op === 'to_xlsx') return `✅ CSV → ${d.out}（${d.rows} 行 × ${d.cols} 列）`
    const head = `📊 ${d.path}｜工作表 ${d.sheet}｜${d.total_rows} 行 × ${d.total_cols} 列${d.sheets?.length > 1 ? `｜全部: ${d.sheets.join(', ')}` : ''}`
    return args.op === 'info' ? head : `${head}\n\n${table(d.rows)}`
  }
  if (cmd === 'sqlite') {
    if (args.op === 'tables') {
      return `🗄 ${d.path}｜${d.count} 个表\n${(d.tables ?? []).map((t) => `${t.name}\t${t.type}\t${t.rows ?? '?'} 行`).join('\n')}`
    }
    if (args.op === 'schema') return `🗄 ${d.path}\n\n${(d.tables ?? []).map((t) => t.sql).join('\n\n')}`
    const cols = d.columns ?? []
    return `🗄 ${d.returned} 行${d.truncated ? `（截断，limit=${d.limit}）` : ''}\n${cols.join('\t')}\n${table(d.rows)}`
  }
  return JSON.stringify(d)
}

function outText(value) {
  const text = typeof value === 'string' ? value : (value && typeof value.text === 'string' ? value.text : JSON.stringify(value))
  return [{ type: 'text', text }]
}

// 工具返回值必须是对象；统一把字符串结果包成 { text }
const wrap = (fn) => async (args) => {
  const r = await fn(args)
  return typeof r === 'string' ? { text: r } : r
}

function tool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: true },
      render: (_args, value) => outText(value),
    },
    execute: spec.execute,
  }
}

const P = (props) => ({ type: 'object', properties: props, required: [], additionalProperties: false })

const IMG = {
  op: { type: 'string', enum: ['info', 'resize', 'compress', 'convert', 'rotate', 'crop'] },
  path: { type: 'string', description: '本机图片绝对路径，如 /sdcard/DCIM/Camera/a.jpg' },
  out: { type: 'string', description: '输出路径，省略则放 /sdcard/Download/DSH-Go/' },
  width: { type: 'integer' }, height: { type: 'integer' },
  max_side: { type: 'integer', description: '最长边缩到多少像素' },
  fit: { type: 'string', enum: ['contain', 'cover'] },
  quality: { type: 'integer', description: '1-100，jpeg/webp 有效' },
  format: { type: 'string', enum: ['jpeg', 'png', 'webp'] },
  angle: { type: 'integer', description: '顺时针角度，90/180/270 最常用' },
  box: { type: 'array', items: { type: 'integer' }, description: '[x, y, 宽, 高]' },
}

const ARCHIVE = {
  op: { type: 'string', enum: ['list', 'extract', 'create'] },
  path: { type: 'string', description: '压缩包路径（list/extract）' },
  dest: { type: 'string', description: '解压目标目录' },
  out: { type: 'string', description: '打包输出路径' },
  files: { type: 'array', items: { type: 'string' }, description: '要打包的文件/目录' },
  format: { type: 'string', enum: ['zip', 'tar.gz'] },
}

const SHEET = {
  op: { type: 'string', enum: ['info', 'read', 'to_csv', 'to_xlsx'] },
  path: { type: 'string' },
  sheet: { type: 'string', description: '工作表名，省略取第一个' },
  limit: { type: 'integer', description: '返回行数，默认 50' },
  offset: { type: 'integer' },
  out: { type: 'string' },
}

const SQLITE = {
  op: { type: 'string', enum: ['tables', 'schema', 'query'] },
  path: { type: 'string', description: '.db/.sqlite 文件路径' },
  sql: { type: 'string', description: '只读 SQL：select / with / pragma / explain' },
  limit: { type: 'integer', description: '默认 100' },
}

const WEB = {
  url: { type: 'string' },
  out: { type: 'string' },
  mode: { type: 'string', enum: ['html', 'text', 'auto'], description: 'auto=按内容类型存原文件；text=去标签存纯文本' },
}

function clean(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

async function webSave(args) {
  bump('web_save')
  const url = String(args.url ?? '')
  if (!/^https?:\/\//i.test(url)) return '❌ 只支持 http(s) 链接'
  let res
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) DSH-Go/1.0' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    return `❌ 抓取失败: ${e.message}`
  }
  if (!res.ok) return `❌ HTTP ${res.status} ${res.statusText}`
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_')
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
  await mkdir(OUT_DIR, { recursive: true })

  const binary = /^(image\/|application\/pdf|application\/octet-stream|audio\/|video\/)/.test(type)
  const ext = type.includes('pdf') ? 'pdf' : type.startsWith('image/') ? (type.split('/')[1] ?? 'png').split(';')[0] : 'bin'
  const dest = args.out || path.join(OUT_DIR, `${host}-${stamp}.${binary ? ext : (args.mode === 'text' ? 'txt' : 'html')}`)

  if (binary) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 20 * 1024 * 1024) return '❌ 文件超过 20MB'
    await writeFile(dest, buf)
    return `✅ 已保存 ${type || 'binary'}（${(buf.length / 1024).toFixed(1)}KB）→ ${dest}`
  }

  const raw = await res.text()
  const text = clean(raw)
  if (args.mode === 'text') {
    await writeFile(dest, text, 'utf8')
    return `✅ 网页正文（${text.length} 字）→ ${dest}\n\n${text.slice(0, 3000)}${text.length > 3000 ? '\n…（已截断，全文在文件里）' : ''}`
  }
  if (args.mode === 'auto' && !/html|xml|text\/plain/.test(type)) {
    await writeFile(dest, raw, 'utf8')
    return `✅ ${type || '未知类型'}（${raw.length} 字）→ ${dest}`
  }
  await writeFile(dest, raw, 'utf8')
  const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().slice(0, 120)
  return `✅ 网页已保存（${(raw.length / 1024).toFixed(1)}KB）→ ${dest}\n标题：${title || '（无）'}\n正文约 ${text.length} 字，需要纯文本可以再用 mode=text。`
}

async function probe() {
  backend.checked = Date.now()
  const res = await runKit('probe', {}, 20_000)
  if (!res.ok) {
    backend.ok = false
    return backend
  }
  backend.ok = true
  backend.python = res.data.python ?? ''
  backend.pillow = res.data.pillow ?? ''
  backend.openpyxl = res.data.openpyxl ?? ''
  return backend
}

export function apply(ctx) {
  ctx.inject(['tools'], (ctx) => {
    ctx.tools.register(tool({
      name: 'img_ops',
      description: '手机图片处理：查看信息、缩放、压缩、转格式、旋转、裁剪。比装图片 App 快，产出默认写到 /sdcard/Download/DSH-Go。',
      parameters: P(IMG),
      execute: wrap((args) => call('img_ops', 'img', args)),
    }))
    ctx.tools.register(tool({
      name: 'archive_ops',
      description: '压缩包读写：列出 zip/tar.gz 内容、解压到指定目录、把文件或整个目录打包。纯内置实现，不依赖系统 unzip。',
      parameters: P(ARCHIVE),
      execute: wrap((args) => call('archive_ops', 'archive', args)),
    }))
    ctx.tools.register(tool({
      name: 'web_save',
      description: '把一个网页抓下来存到手机：默认存原始 HTML，mode=text 得到去掉标签的正文；图片/PDF 直接存原文件。适合离线保存文章。',
      parameters: P(WEB),
      execute: wrap((args) => webSave(args)),
    }))
    ctx.tools.register(tool({
      name: 'sheet_ops',
      description: '表格处理：CSV/xlsx 看行列数、读前 N 行、CSV 转 xlsx、xlsx 转 CSV。不用打开 Office。',
      parameters: P(SHEET),
      execute: wrap((args) => call('sheet_ops', 'sheet', args)),
    }))
    ctx.tools.register(tool({
      name: 'sqlite_query',
      description: '只读查询手机上任意 SQLite 数据库：列表、看建表语句、跑 SELECT。拒绝任何写操作。',
      parameters: P(SQLITE),
      execute: wrap((args) => call('sqlite_query', 'sqlite', args)),
    }))
    ctx.tools.register(tool({
      name: 'kit_health',
      description: '检查鲸鲸工具箱后端状态（python、Pillow、openpyxl、SQLite 版本和各工具使用次数）。',
      parameters: P({}),
      execute: wrap(async () => {
        const b = await probe()
        const lines = [
          `后端 ${b.ok ? '✅ 正常' : '❌ 不可用'}`,
          `Python ${b.python || '?'}｜Pillow ${b.pillow || '无'}｜openpyxl ${b.openpyxl || '无'}`,
          `产出目录 ${OUT_DIR}`,
          '',
          ...['img_ops', 'archive_ops', 'web_save', 'sheet_ops', 'sqlite_query'].map((n) => `${n}\t${usage[n] ?? 0} 次`),
        ]
        return lines.join('\n')
      }),
    }))
  })

  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.panel('kit', {
      view: (scope, caps) => {
        const en = String(caps.locale ?? '').startsWith('en')
        return {
          type: 'stack',
          title: en ? 'Whale Kit' : '鲸鲸工具箱',
          children: [
            { type: 'metric', label: en ? 'Backend' : '后端', value: { $: 'data.state' }, tone: { $: 'data.tone' } },
            {
              type: 'compare',
              items: [
                { title: en ? 'Runtime' : '运行环境', rows: [['Python', { $: 'data.python' }], ['Pillow', { $: 'data.pillow' }], ['openpyxl', { $: 'data.openpyxl' }]] },
                { title: en ? 'Usage' : '使用次数', rows: [['图片', { $: 'data.img' }], ['压缩包', { $: 'data.archive' }], ['网页落盘', { $: 'data.web' }], ['表格', { $: 'data.sheet' }], ['SQLite', { $: 'data.sqlite' }]] },
              ],
            },
            { type: 'callout', text: { $: 'data.hint' }, tone: 'info' },
          ],
        }
      },
      data: (scope, emit) => {
        const push = async () => {
          if (backend.checked === 0) await probe()
          emit({
            state: backend.ok ? '✅ 就绪' : '❌ 不可用',
            tone: backend.ok ? 'good' : 'bad',
            python: backend.python || '?',
            pillow: backend.pillow || '无',
            openpyxl: backend.openpyxl || '无',
            img: String(usage.img_ops ?? 0), archive: String(usage.archive_ops ?? 0),
            web: String(usage.web_save ?? 0), sheet: String(usage.sheet_ops ?? 0),
            sqlite: String(usage.sqlite_query ?? 0),
            hint: '产出默认写到 手机存储/Download/DSH-Go；写操作前会让你确认。',
          })
        }
        void push()
        const timer = setInterval(() => { void push() }, 20_000)
        return () => clearInterval(timer)
      },
    })
  })
}
