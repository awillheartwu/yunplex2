import { addTemplate, defineNuxtModule } from 'nuxt/kit'
import { scanSettings } from './settings-search/scan'

export default defineNuxtModule({
  meta: { name: 'yunplex-settings-search' },
  setup(_options, nuxt) {
    let catalog: Awaited<ReturnType<typeof scanSettings>>
    // Nuxt calls this before template generation, including dev file changes.
    // Errors must escape this hook: individual template errors can be swallowed.
    nuxt.hook('app:templates', async () => {
      catalog = await scanSettings(nuxt.options.rootDir)
    })
    addTemplate({
      filename: 'settings-search-index.ts',
      write: true,
      getContents: () => `// Generated from settings components. Do not edit.\nexport default ${JSON.stringify(catalog, null, 2)} as const\n`,
    })
  },
})
