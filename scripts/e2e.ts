/** End-to-end smoke test driven by aio's own `am` manager rather than curl.
 *
 *  What it proves: the app boots as a real aio server, the persisted `scores`
 *  cell is reachable and writable over the wire, and the UI surface renders
 *  server-side. The `game` cell is scope:'client', so it is deliberately NOT
 *  asserted here — it never registers with the server store, and `am state`
 *  cannot see it. That half is covered by tests/app.test.ts, through the DOM.
 *
 *  The app is booted with --client=server-only: `am start` would launch the
 *  configured Electron client, which needs a display.
 *
 *  Usage: deno task e2e
 */

// An ephemeral port, never the app's default: a `deno task dev` instance
// already holds the aio singleton lock on 8123, and reusing it silently
// pointed every `am` command at the REAL app — which is how test scores once
// ended up in the real leaderboard.
const PORT = String(await freePort())
const decoder = new TextDecoder()

async function freePort(): Promise<number> {
  const l = Deno.listen({ port: 0 })
  const { port } = l.addr as Deno.NetAddr
  l.close()
  await Promise.resolve()
  return port
}

// Run against a throwaway data directory. aio stores state under $HOME, so a
// temp HOME keeps the e2e from writing test scores into the real leaderboard.
// DENO_DIR is pinned back to the real module cache — otherwise the sandboxed
// child re-downloads every dependency and never boots.
const SANDBOX = await Deno.makeTempDir({ prefix: 'space-invaders-e2e-' })
const REAL_HOME = Deno.env.get('HOME') ?? ''
const CHILD_ENV = {
  ...Deno.env.toObject(),
  HOME: SANDBOX,
  DENO_DIR: Deno.env.get('DENO_DIR') ?? `${REAL_HOME}/.cache/deno`,
  // aio's singleton lock lives in the runtime dir, not $HOME — without this a
  // `deno task dev` instance makes the sandboxed child refuse to start.
  XDG_RUNTIME_DIR: `${SANDBOX}/run`,
}
await Deno.mkdir(`${SANDBOX}/run`, { recursive: true })

async function am(...args: string[]): Promise<{ code: number; out: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', 'dep/aio/src/am.ts', ...args, `--port=${PORT}`],
    env: CHILD_ENV,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  return { code, out: (decoder.decode(stdout) + decoder.decode(stderr)).trim() }
}

let failures = 0
const step = (label: string) => console.log(`\n\x1b[36m▸ ${label}\x1b[0m`)
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

step('boot the app (server-only, no window)')
const app = new Deno.Command(Deno.execPath(), {
  args: ['run', '-A', 'src/app.ts', '--client=server-only', `--port=${PORT}`],
  env: CHILD_ENV,
  stdout: 'piped',
  stderr: 'piped',
}).spawn()

try {
  // `am expect --wait` does the polling for us — no sleep guesswork.
  const up = await am('expect', 'scores.hiScore', 'exists', '--wait=20')
  check('the app came up and answers state queries', up.code === 0, up.out.slice(0, 140))
  if (up.code !== 0) {
    app.stdout.cancel().catch(() => {})
    const err = decoder.decode(await new Response(app.stderr).arrayBuffer().then((b) => new Uint8Array(b)))
    throw new Error(`app never became ready. child stderr:\n${err.slice(-1200)}`)
  }

  // Refuse to run against anything but our own sandboxed child: an empty board
  // is the fingerprint of a fresh temp HOME.
  const fresh = await am('state', 'scores.entries')
  if (!/\[\s*\]/.test(fresh.out)) {
    throw new Error(
      `e2e aborted: port ${PORT} is answering with a non-empty leaderboard ` +
        `(${fresh.out.slice(0, 120)}). That is not the sandboxed instance — refusing to write to it.`,
    )
  }
  check('talking to the sandboxed instance, not a real one', true, 'empty board')

  step('the persisted scores cell is reachable')
  const state = await am('state', 'scores')
  check('am state scores', state.code === 0, state.out.slice(0, 120))

  step('a submitted score lands in the leaderboard')
  await am('dispatch', 'scores:submit', 'name=E2EE', 'score=99999', 'wave=3')
  const hi = await am('expect', 'scores.hiScore', 'eq', '99999', '--wait=10')
  check('hi-score updated to 99999', hi.code === 0, hi.out.slice(0, 140))

  const board = await am('state', 'scores.entries')
  check('the entry is on the board', board.out.includes('E2EE'), board.out.slice(0, 160))

  step('the UI surface renders server-side')
  const surface = await am('surface', 'server')
  check('am surface server returns a tree', surface.code === 0 && surface.out.length > 0)

  step('the dispatch journal is queryable')
  const timeline = await am('timeline', '--lines=5')
  check('am timeline', timeline.code === 0)

  step('persisted cell versions agree with what is declared')
  // Guards the classic hazard: a cell rename silently drops its stored state
  // (see the note on the scores cell).
  const migrations = await am('migrations')
  // The payload always carries a `drift` key; what matters is that it is empty.
  const drift = ((): unknown[] | null => {
    try {
      return (JSON.parse(migrations.out) as { drift?: unknown[] }).drift ?? []
    } catch {
      return null
    }
  })()
  check(
    'am migrations reports no shape drift',
    migrations.code === 0 && drift !== null && drift.length === 0,
    migrations.out.slice(0, 160),
  )
} finally {
  step('shut down')
  try {
    app.kill('SIGTERM')
  } catch { /* already gone */ }
  const status = await app.status
  check('app exited on SIGTERM', status.signal === 'SIGTERM' || status.success, JSON.stringify(status))
  const gone = await am('state', 'scores')
  check('the sandboxed instance no longer answers', gone.code !== 0, gone.out.slice(0, 100))
  await Deno.remove(SANDBOX, { recursive: true }).catch(() => {})
}

console.log(
  failures === 0
    ? '\n\x1b[32me2e: all checks passed\x1b[0m'
    : `\n\x1b[31me2e: ${failures} check(s) failed\x1b[0m`,
)
Deno.exit(failures === 0 ? 0 : 1)
