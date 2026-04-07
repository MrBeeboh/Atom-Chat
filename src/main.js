import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const target = document.getElementById('app')
if (!target) {
  document.body.innerHTML = '<pre class="error-pre">No #app element found.</pre>'
} else {
  try {
    mount(App, { target })
  } catch (err) {
    target.innerHTML = `<pre class="error-pre">Mount failed:\n${err?.message ?? err}\n\n${err?.stack ?? ''}</pre>`
    console.error('ATOM mount error', err)
  }
}
