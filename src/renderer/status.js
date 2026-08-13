// Status surface for the shell. Plain script on purpose: it must render before
// the backend exists, so it depends on nothing that needs building or fetching.

const api = window.harnessDesktop

const stage = document.querySelector('.stage')
const statusText = document.getElementById('status')
const hint = document.getElementById('hint')
const actions = document.getElementById('actions')
const log = document.getElementById('log')
const logBody = document.getElementById('log-body')
const footer = document.getElementById('footer')

function render(state) {
  stage.dataset.phase = state.phase

  if (state.phase === 'failed') {
    statusText.textContent = state.message
    hint.textContent = state.hint ?? ''
    hint.hidden = !state.hint
    actions.hidden = false
    const lines = state.logTail ?? []
    logBody.textContent = lines.join('\n')
    log.hidden = lines.length === 0
    return
  }

  statusText.textContent =
    state.phase === 'ready' ? 'Opening the Harness interface…' : state.message
  hint.hidden = true
  actions.hidden = true
  log.hidden = true
}

async function renderFooter() {
  const env = await api.getEnvironment()
  const runtime = env.nodeRuntime ? `Node ${env.nodeRuntime.version}` : 'Node unresolved'
  const harness = env.dshVersion ? `Harness ${env.dshVersion}` : 'Harness payload missing'
  footer.textContent = `v${env.appVersion} · ${harness} · ${runtime} · ${env.platform}-${env.arch}`
}

document.getElementById('retry').addEventListener('click', () => {
  render({ phase: 'restarting', message: 'Restarting the Harness backend…' })
  void api.restartBackend()
})

document.getElementById('logs').addEventListener('click', () => {
  void api.openLogFolder()
})

document.getElementById('copy').addEventListener('click', async (event) => {
  await api.copyDiagnostics()
  const button = event.currentTarget
  const original = button.textContent
  button.textContent = 'Copied'
  setTimeout(() => {
    button.textContent = original
  }, 1600)
})

api.onStateChanged(render)
void api.getState().then(render)
void renderFooter()
