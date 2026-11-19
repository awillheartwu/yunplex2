import { readFile, readdir } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'
import { tabs } from '../../lib/settings-navigation'
import type { SettingDefinition, SettingsSection } from '../../lib/settings-types'

type TemplateRoot = NonNullable<NonNullable<ReturnType<typeof parse>['descriptor']['template']>['ast']>
type Element = Extract<TemplateRoot['children'][number], { type: 1 }>

async function vueFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => {
    const file = resolve(directory, entry.name)
    return entry.isDirectory() ? vueFiles(file) : entry.name.endsWith('.vue') ? [file] : []
  }))
  return files.flat().sort()
}

export async function scanSettings(rootDir: string) {
  const sections: Record<string, SettingsSection> = Object.create(null)
  const settings: Record<string, SettingDefinition> = Object.create(null)
  const locations = new Map<string, string>()
  const files = [resolve(rootDir, 'pages/config.vue'), ...await vueFiles(resolve(rootDir, 'components/config'))]

  for (const file of files) {
    // Reusable controls declare dynamic targets; index their concrete callers.
    if (['ConfigSection', 'FormField', 'ToggleField'].includes(basename(file, '.vue'))) continue
    const { descriptor, errors } = parse(await readFile(file, 'utf8'), { filename: file })
    if (errors.length) throw new Error(`[settings-search] ${relative(rootDir, file)}: ${errors[0]}`)

    function fail(node: Element, message: string): never {
      throw new Error(`[settings-search] ${relative(rootDir, file)}:${node.loc.start.line}: ${message}`)
    }

    function attribute(node: Element, name: string): string | undefined {
      for (const prop of node.props) {
        if (prop.type === 6 && prop.name === name) return prop.value?.content.trim() ?? ''
        if (prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === name) {
          fail(node, `${name} must be a static string`)
        }
      }
    }

    function required(node: Element, name: string): string {
      const value = attribute(node, name)
      if (!value) fail(node, `missing ${name}`)
      return value
    }

    function register(node: Element, key: string) {
      const identifier = key.startsWith('section:') ? key.slice(8) : key
      if (!/^[A-Za-z][\w.-]*$/.test(identifier)) fail(node, `invalid setting identifier ${key}`)
      const id = `setting-${key.replace(/[:.]/g, '-')}`
      const previous = locations.get(id)
      if (previous) fail(node, `duplicate setting target ${key}; first declared at ${previous}`)
      locations.set(id, `${relative(rootDir, file)}:${node.loc.start.line}`)
    }

    function visit(nodes: TemplateRoot['children'], parentSection?: string) {
      for (const node of nodes) {
        if (node.type !== 1) continue
        const target = attribute(node, 'data-setting-target')
        const isSection = node.tag === 'ConfigSection'
        let section = parentSection
        if (isSection || target?.startsWith('section:')) {
          section = isSection ? required(node, 'section-key') : target!.slice(8)
          register(node, `section:${section}`)
          const prefix = isSection ? '' : 'data-setting-'
          const tab = required(node, isSection ? 'search-tab' : `${prefix}tab`)
          if (!tabs.some(item => item.key === tab)) fail(node, `unknown settings tab ${tab}`)
          sections[section] = {
            tab,
            title: required(node, `${prefix}title`),
            description: attribute(node, `${prefix}description`) ?? '',
            keywords: attribute(node, isSection ? 'search-keywords' : `${prefix}keywords`),
          }
        } else if (node.tag === 'FormField' || node.tag === 'ToggleField' || target) {
          const key = target || attribute(node, 'setting')
          if (!key && parentSection) fail(node, 'settings fields need a stable setting identifier')
          if (key) {
            register(node, key)
            const prefix = target ? 'data-setting-' : 'search-'
            settings[key] = {
              label: required(node, target ? `${prefix}label` : 'label'),
              section: attribute(node, `${prefix}section`) || parentSection || fail(node, `${key} has no settings section`),
              keywords: attribute(node, `${prefix}keywords`),
              fallback: attribute(node, `${prefix}fallback`),
              hiddenHint: attribute(node, `${prefix}hidden-hint`),
            }
          }
        }
        visit(node.children, section)
      }
    }

    if (descriptor.template?.ast) visit(descriptor.template.ast.children)
  }

  for (const [key, definition] of Object.entries(settings)) {
    const location = locations.get(`setting-${key.replace(/[:.]/g, '-')}`)
    const fail = (message: string): never => { throw new Error(`[settings-search] ${location}: ${message}`) }
    if (!Object.hasOwn(sections, definition.section)) fail(`unknown section ${definition.section} for ${key}`)
    if (definition.fallback) {
      const fallback = settings[definition.fallback]
      if (!fallback || fallback.section !== definition.section) fail(`${key} needs a fallback in the same section`)
      if (!definition.hiddenHint) fail(`${key} is missing its hidden setting hint`)
    } else if (definition.hiddenHint) fail(`${key} is missing its hidden setting fallback`)
  }

  return { sections, settings }
}
