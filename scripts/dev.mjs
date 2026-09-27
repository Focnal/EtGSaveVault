import { createServer } from 'vite'
import { context } from 'esbuild'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const PORT = 5199
const url = `http://localhost:${PORT}/`

let electronProcess = null
let restarting = false

function launchElectron() {
  if (electronProcess) {
    restarting = true
    electronProcess.kill()
  }
  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url }
  })
  electronProcess = child
  child.on('close', (code) => {
    if (electronProcess === child) electronProcess = null
    if (restarting) {
      restarting = false
      return
    }
    process.exit(code ?? 0)
  })
}

const server = await createServer()
await server.listen()

const entries = [
  ['electron/main.ts', 'dist-electron/main.js'],
  ['electron/preload.ts', 'dist-electron/preload.js']
]
const built = new Set()

const contexts = await Promise.all(
  entries.map(([entry, outfile]) =>
    context({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      sourcemap: true,
      plugins: [
        {
          name: 'relaunch',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length > 0) return
              built.add(entry)
              if (built.size === entries.length) launchElectron()
            })
          }
        }
      ]
    })
  )
)

await Promise.all(contexts.map((c) => c.watch()))
console.log(`[dev] renderer: ${url}`)

process.on('SIGINT', async () => {
  await Promise.all(contexts.map((c) => c.dispose()))
  await server.close()
  if (electronProcess) electronProcess.kill()
  process.exit(0)
})
