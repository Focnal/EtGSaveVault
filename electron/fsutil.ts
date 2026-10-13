import fs from 'node:fs/promises'
import path from 'node:path'

/** 访问出错时视为不存在 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 递归统计文件数与总字节数，无法读取的条目跳过 */
export async function walkStats(dir: string): Promise<{ count: number; size: number }> {
  let count = 0
  let size = 0
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile()) {
        count += 1
        try {
          size += (await fs.stat(full)).size
        } catch {
          // 忽略读取失败的个别文件
        }
      }
    }
  }
  return { count, size }
}

/** 递归复制目录，每复制完一个文件回调一次 */
export async function copyDir(src: string, dest: string, onFile: () => void): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      await copyDir(s, d, onFile)
    } else if (e.isFile()) {
      await fs.copyFile(s, d)
      onFile()
    }
  }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** 备份名称时间戳：yyyyMMdd_HHmmss */
export function timestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/** 回档点 ID：yyyyMMdd_HHmmss_SSS，毫秒保证唯一且可按名排序 */
export function pointStamp(d = new Date()): string {
  return `${timestamp(d)}_${pad(d.getMilliseconds(), 3)}`
}
