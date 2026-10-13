#!/usr/bin/env node
/**
 * 用国内镜像（淘宝 npmmirror）执行需要联网下载的构建命令。
 *
 * Electron 相关文件默认从 GitHub Releases 下载，国内网络下经常长时间卡住：
 *   - `npm install`   ：electron 包的 postinstall 要下载 Electron 二进制（100MB 级）
 *   - `npm run make`  ：electron-builder 还要额外下载 Electron 压缩包、winCodeSign、NSIS、7zip 等打包工具
 *
 * 用法：
 *   node scripts/mirror.mjs [选项] -- <命令> [参数...]
 *
 * 示例：
 *   node scripts/mirror.mjs -- npm install
 *   node scripts/mirror.mjs --timeout=600 -- npx electron-builder --win
 *
 * 选项：
 *   --mirror=cn      镜像预设，默认 cn（淘宝 npmmirror）
 *   --timeout=<秒>   超过该时间还没结束就终止命令（防止下载卡死），默认不限时
 *   -h, --help       显示帮助
 */
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** 镜像预设：需要哪些环境变量，取决于 Electron / electron-builder 的读取方式 */
export const MIRROR_PRESETS = {
  cn: {
    ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
}

/** 在 env 上叠加镜像预设，返回新的 env（不修改入参） */
export function mirrorEnv(preset = 'cn', env = process.env) {
  const vars = MIRROR_PRESETS[preset]
  if (!vars) {
    throw new Error(`未知的镜像预设：${preset}（可用：${Object.keys(MIRROR_PRESETS).join('、')}）`)
  }
  return { ...env, ...vars }
}

export function parseMirrorArgs(argv) {
  const options = { mirror: 'cn', timeoutSec: 0, help: false, command: [] }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest[0]
    if (arg === '--') {
      rest.shift()
      break
    }
    if (arg === '-h' || arg === '--help') {
      options.help = true
      rest.shift()
      continue
    }
    if (arg.startsWith('--mirror=')) {
      options.mirror = arg.slice('--mirror='.length)
      rest.shift()
      continue
    }
    if (arg.startsWith('--timeout=')) {
      const seconds = Number(arg.slice('--timeout='.length))
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`--timeout 需要是秒数，收到：${arg}`)
      options.timeoutSec = seconds
      rest.shift()
      continue
    }
    if (arg.startsWith('-')) throw new Error(`未知选项：${arg}（用 --help 查看用法）`)
    break
  }
  options.command = rest
  return options
}

const HELP = `用国内镜像执行需要联网下载的构建命令

用法：node scripts/mirror.mjs [选项] -- <命令> [参数...]

选项：
  --mirror=cn      镜像预设，默认 cn（淘宝 npmmirror）
  --timeout=<秒>   超过该时间还没结束就终止命令（防止下载卡死），默认不限时
  -h, --help       显示本帮助

示例：
  node scripts/mirror.mjs -- npm install
  node scripts/mirror.mjs --timeout=600 -- npx electron-builder --win
`

/** Windows 下 .cmd / .bat 必须经过 shell 才能执行，这里统一拼成命令行字符串 */
function toCommandLine(command, args) {
  return [command, ...args]
    .map((part) => (/[\s"]/.test(part) ? `"${part.replace(/(["\\])/g, '\\$1')}"` : part))
    .join(' ')
}

/** 在 npm scripts 里运行时，npm 会给出自己的入口脚本，直接用它可绕开 PATH 与 shell 转义 */
function toSpawn(command, args) {
  if (command === 'npm' && process.env.npm_execpath) {
    return { file: process.execPath, args: [process.env.npm_execpath, ...args], shell: false }
  }
  if (process.platform === 'win32') {
    return { file: toCommandLine(command, args), args: [], shell: true }
  }
  return { file: command, args, shell: false }
}

function run(options) {
  const { command, mirror, timeoutSec } = options
  if (command.length === 0) {
    process.stderr.write(HELP)
    process.exit(2)
  }

  const env = mirrorEnv(mirror)
  const [file, ...args] = command
  const spawnOptions = toSpawn(file, args)
  const printable = toCommandLine(file, args)

  console.log(`[mirror] 镜像预设 ${mirror}：`)
  for (const [key, value] of Object.entries(MIRROR_PRESETS[mirror])) console.log(`[mirror]   ${key}=${value}`)
  console.log(`[mirror] 执行：${printable}${timeoutSec > 0 ? `（超时 ${timeoutSec}s）` : ''}\n`)

  const child = spawn(spawnOptions.file, spawnOptions.args, {
    stdio: 'inherit',
    shell: spawnOptions.shell,
    env,
    cwd: process.cwd()
  })

  let timedOut = false
  const timer =
    timeoutSec > 0
      ? setTimeout(() => {
          timedOut = true
          console.error(`\n[mirror] 已超过 ${timeoutSec}s，终止命令：${printable}`)
          if (process.platform === 'win32' && child.pid !== undefined) {
            spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          } else {
            child.kill('SIGKILL')
          }
        }, timeoutSec * 1000)
      : null

  child.on('error', (err) => {
    if (timer) clearTimeout(timer)
    console.error(`[mirror] 无法启动命令：${err.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (timer) clearTimeout(timer)
    if (timedOut) process.exit(124)
    if (code !== null) process.exit(code)
    console.error(`[mirror] 命令被信号 ${signal} 终止`)
    process.exit(1)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseMirrorArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(HELP)
      process.exit(0)
    }
    run(options)
  } catch (err) {
    process.stderr.write(`[mirror] ${err.message}\n`)
    process.exit(2)
  }
}
