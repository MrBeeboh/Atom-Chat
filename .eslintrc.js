module.exports = {
  root: true,
  env: { browser: true, es2021: true },
  extends: [
    'eslint:recommended',
    '@sveltejs/eslint-config',
    '@sveltejs/eslint-config/recommended',
    'plugin:sveltejs/recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  overrides: [
    {
      files: ['*.svelte'],
      processor: 'svelte3/svelte'
    },
    {
      files: ['*.{js,ts}'],
      rules: {
        'no-unused-vars': 'warn'
      }
    }
  ],
  rules: {
    'svelte/no-at-html-tags': 'warn',
    'svelte/valid-compile': 'error',
    'svelte/no-unused-svelte-ignore': 'warn'
  },
  settings: {
    'svelte3/ignore-styles': true
  }
}