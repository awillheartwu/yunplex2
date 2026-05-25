<template>
  <div class="max-w-[1440px] space-y-8">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">配置</h2>
        <p class="text-2xs text-muted mt-0.5">管理网易云音乐和 Plex 的连接与同步设置</p>
      </div>
      <div class="flex items-center gap-4">
        <button class="btn btn-ghost btn-sm" @click="toggleAll">
          {{ allExpanded ? '收起全部' : '展开全部' }}
        </button>
        <button class="btn btn-danger btn-sm" @click="showResetConfirm = true">
          恢复默认
        </button>
        <button class="btn btn-primary" :disabled="saving" @click="handleSave">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
        <span v-if="saveMsg" class="text-sm transition-opacity duration-300" :class="saveOk ? 'text-success' : 'text-danger'">
          {{ saveOk ? '✓' : '✗' }} {{ saveMsg }}
        </span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-muted text-sm">加载配置...</span>
    </div>

    <!-- Form -->
    <template v-else-if="form">
      <!-- Netease -->
      <section class="section-card overflow-hidden">
        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
          :class="collapsed.netease ? 'border-b border-transparent' : 'border-b border-[var(--border-primary)]'"
          @click="toggle('netease')"
        >
          <div>
            <div class="flex items-center gap-2">
              <SidebarIcon name="music" :active="true" />
              <h3 class="text-sm font-semibold">网易云音乐</h3>
            </div>
            <p class="text-2xs text-muted mt-0.5">用于获取歌单和歌曲下载链接的认证信息</p>
          </div>
          <Chevron :open="!collapsed.netease" />
        </div>
        <div v-show="!collapsed.netease" class="p-5 space-y-4">
          <FormField label="Cookie" hint="从浏览器开发者工具中复制网易云音乐的 Cookie" required>
            <input
              v-model="form.netease.cookie"
              type="password"
              placeholder="MUSIC_U=xxx; __csrf=xxx; ..."
              class="form-input font-mono"
              @focus="($event.target as HTMLInputElement).type='text'"
              @blur="($event.target as HTMLInputElement).type='password'"
            />
          </FormField>
          <FormField label="歌单 ID" hint="多个 ID 用英文逗号分隔，可在网易云歌单 URL 中找到" required>
            <input
              v-model="playlistIdsText"
              type="text"
              placeholder="123456789, 987654321"
              class="form-input"
            />
          </FormField>
          <FormField label="音质偏好">
            <select v-model="form.netease.quality" class="form-input">
              <option value="standard">标准 (128kbps)</option>
              <option value="higher">较高 (192kbps)</option>
              <option value="exhigh">极高 (320kbps)</option>
              <option value="lossless">无损 (FLAC)</option>
              <option value="hires">Hi-Res</option>
              <option value="jyeffect">高清环绕声</option>
              <option value="jymaster">超清母带</option>
            </select>
          </FormField>
          <div class="pt-1 flex items-center gap-4">
            <button
              class="btn btn-ghost btn-sm"
              :disabled="testing === 'netease'"
              @click="testConnection('netease')"
            >
              {{ testing === 'netease' ? '测试中...' : '测试网易云连接' }}
            </button>
            <span v-if="testResult['netease']" class="text-sm" :class="testResult['netease'].ok ? 'text-success' : 'text-danger'">
              {{ testResult['netease'].ok ? '✓' : '✗' }} {{ testResult['netease'].msg }}
            </span>
          </div>
        </div>
      </section>

      <!-- Plex -->
      <section class="section-card overflow-hidden">
        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
          :class="collapsed.plex ? 'border-b border-transparent' : 'border-b border-[var(--border-primary)]'"
          @click="toggle('plex')"
        >
          <div>
            <div class="flex items-center gap-2">
              <SidebarIcon name="sync" :active="true" />
              <h3 class="text-sm font-semibold">Plex Media Server</h3>
            </div>
            <p class="text-2xs text-muted mt-0.5">连接 Plex 媒体服务器以同步歌单</p>
          </div>
          <Chevron :open="!collapsed.plex" />
        </div>
        <div v-show="!collapsed.plex" class="p-5 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <FormField label="服务器地址" required>
              <input v-model="form.plex.server" type="text" placeholder="192.168.1.100" class="form-input" />
            </FormField>
            <FormField label="端口" required>
              <input v-model.number="form.plex.port" type="number" placeholder="32400" class="form-input" />
            </FormField>
          </div>
          <FormField label="Token (X-Plex-Token)" hint="在 Plex 网页版的 XML 响应中可以找到" required>
            <input v-model="form.plex.token" type="password" placeholder="your-plex-token" class="form-input font-mono" @focus="($event.target as HTMLInputElement).type='text'" @blur="($event.target as HTMLInputElement).type='password'" />
          </FormField>
          <FormField label="音乐库名称" hint="Plex 中存放音乐的库名称，用于刷新和同步">
            <input v-model="form.plex.section" type="text" placeholder="音乐" class="form-input" />
          </FormField>
          <div class="pt-1 flex items-center gap-4">
            <button
              class="btn btn-ghost btn-sm"
              :disabled="testing === 'plex'"
              @click="testConnection('plex')"
            >
              {{ testing === 'plex' ? '测试中...' : '测试 Plex 连接' }}
            </button>
            <span v-if="testResult['plex']" class="text-sm" :class="testResult['plex'].ok ? 'text-success' : 'text-danger'">
              {{ testResult['plex'].ok ? '✓' : '✗' }} {{ testResult['plex'].msg }}
            </span>
          </div>
        </div>
      </section>

      <!-- Download -->
      <section class="section-card overflow-hidden">
        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
          :class="collapsed.download ? 'border-b border-transparent' : 'border-b border-[var(--border-primary)]'"
          @click="toggle('download')"
        >
          <div>
            <div class="flex items-center gap-2">
              <SidebarIcon name="download" :active="true" />
              <h3 class="text-sm font-semibold">下载与文件</h3>
            </div>
            <p class="text-2xs text-muted mt-0.5">歌曲文件的存储路径和元数据处理选项</p>
          </div>
          <Chevron :open="!collapsed.download" />
        </div>
        <div v-show="!collapsed.download" class="p-5 space-y-4">
          <FormField label="下载目录" hint="下载的歌曲将按 艺术家/专辑 的结构存放在此目录" required>
            <input v-model="form.download.dir" type="text" placeholder="/mnt/nas" class="form-input" />
          </FormField>
          <div class="space-y-3">
            <ToggleField v-model="form.download.downloadLyrics" label="下载歌词" hint="下载 .lrc 歌词文件与歌曲放在一起" />
            <ToggleField v-model="form.download.embedMetadata" label="写入元数据标签" hint="将歌曲名、艺术家、专辑等信息写入 ID3/FLAC 标签" />
            <ToggleField v-model="form.download.embedCover" label="嵌入封面图" hint="将专辑封面嵌入到音频文件中" />
            <ToggleField v-model="form.download.saveAlbumCover" label="保存专辑封面" hint="将专辑封面保存为 cover.jpg 到专辑文件夹" />
            <ToggleField v-model="form.download.saveArtistImage" label="保存歌手图片" hint="将歌手头像保存为 artist.jpg 到歌手文件夹（首次下载后不覆盖）" />
          </div>
        </div>
      </section>

      <!-- Sync strategy -->
      <section class="section-card overflow-hidden">
        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
          :class="collapsed.sync ? 'border-b border-transparent' : 'border-b border-[var(--border-primary)]'"
          @click="toggle('sync')"
        >
          <div>
            <div class="flex items-center gap-2">
              <SidebarIcon name="play" :active="true" />
              <h3 class="text-sm font-semibold">同步策略</h3>
            </div>
            <p class="text-2xs text-muted mt-0.5">控制同步的频率和范围</p>
          </div>
          <Chevron :open="!collapsed.sync" />
        </div>
        <div v-show="!collapsed.sync" class="p-5 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <FormField label="同步间隔（分钟）" hint="建议 30-60 分钟">
              <input v-model.number="form.sync.intervalMinutes" type="number" min="1" max="1440" class="form-input" />
            </FormField>
            <FormField label="歌曲数量上限" hint="每次同步处理的歌曲数量">
              <input v-model.number="form.sync.songLimit" type="number" min="1" max="1000" class="form-input" />
            </FormField>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <FormField label="日志保留天数" hint="超过该天数的日志将在下次写日志时自动清理。另有 5,000 行硬上限兜底">
              <input v-model.number="form.sync.logRetentionDays" type="number" min="1" max="365" class="form-input" />
            </FormField>
            <FormField label="成功任务保留天数" hint="成功的同步记录保留天数，超期自动清理">
              <input v-model.number="form.sync.jobRetentionSuccessDays" type="number" min="1" max="365" class="form-input" />
            </FormField>
            <FormField label="失败任务保留天数" hint="失败或部分失败的记录保留更久，方便排查问题">
              <input v-model.number="form.sync.jobRetentionFailedDays" type="number" min="1" max="365" class="form-input" />
            </FormField>
          </div>
          <ToggleField v-model="form.sync.enabled" label="启用自动同步" hint="开启后将在后台按设定间隔自动同步歌单" />
        </div>
      </section>

      <!-- Other strategies -->
      <section class="section-card overflow-hidden">
        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
          :class="collapsed.other ? 'border-b border-transparent' : 'border-b border-[var(--border-primary)]'"
          @click="toggle('other')"
        >
          <div>
            <div class="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#5e6ad2" stroke-width="1.3"/><path d="M5.5 7.5h5M5.5 10h3" stroke="#5e6ad2" stroke-width="1.3" stroke-linecap="round"/></svg>
              <h3 class="text-sm font-semibold">其他策略</h3>
            </div>
            <p class="text-2xs text-muted mt-0.5">细节行为控制</p>
          </div>
          <Chevron :open="!collapsed.other" />
        </div>
        <div v-show="!collapsed.other" class="p-5 space-y-4">
          <FormField label="存储路径格式">
            <template #hint>
              <span class="inline-flex items-center gap-1">
                <span>用 / 分隔目录层级</span>
                <span class="relative inline-flex group">
                  <span class="text-accent cursor-help underline decoration-dotted underline-offset-2">变量说明</span>
                  <div class="absolute bottom-full left-0 mb-2 w-72 bg-[var(--bg-app)] border border-[var(--border-secondary)] rounded-lg p-3 text-2xs space-y-1.5 font-mono shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                    <p class="text-muted mb-2">可用变量（/ 表示新建一层目录）：</p>
                    <div v-for="v in pathVarHelp" :key="v.key" class="flex gap-4">
                      <code class="text-accent w-32 shrink-0">{{ '{' + v.key + '}' }}</code>
                      <span class="text-muted-deep">{{ v.desc }}</span>
                    </div>
                  </div>
                </span>
              </span>
            </template>
            <select v-model="pathFormatMode" class="form-input">
              <option v-for="p in pathPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
              <option value="__custom__">自定义...</option>
            </select>
            <input
              v-if="pathFormatMode === '__custom__'"
              v-model="form.other.pathFormat"
              type="text"
              placeholder="{artist}/{album} ({year})/{track:02d} - {title}"
              class="form-input mt-2"
            />
          </FormField>
          <FormField label="多歌手格式" hint="多人合作歌曲写入 Track Artist 的分隔格式。正确的格式可被 Plexamp 等客户端识别为多歌手关联">
            <select v-model="form.other.multiArtistFormat" class="form-input">
              <option value="ampersand">A & B → A, B & C</option>
              <option value="and">A and B → A, B and C</option>
              <option value="comma">A, B → A, B, C</option>
              <option value="slash">A / B → A / B / C</option>
              <option value="plus">A + B → A + B + C</option>
              <option value="feat">A feat. B → A feat. B, C & D</option>
              <option value="ft">A ft. B → A ft. B, C & D</option>
              <option value="featuring">A featuring B → A featuring B, C & D</option>
              <option value="with">A with B → A with B, C & D</option>
            </select>
          </FormField>
          <ToggleField
            v-model="form.other.downloadTranslatedLyric"
            label="下载翻译歌词"
            hint="关闭后只下载原文歌词，不合并翻译版本。适合不需要双语歌词的用户"
          />
          <FormField v-if="form.other.downloadTranslatedLyric" label="双语歌词存储方式" hint="合并到一个文件或分开保存为两个文件">
            <select v-model="form.other.lyricOrder" class="form-input">
              <option value="original_first">合并：原文在上 / 翻译在下（翻译高亮）</option>
              <option value="translated_first">合并：翻译在上 / 原文在下（原文高亮）</option>
              <option value="separate">分开存储：歌名 (orgi).lrc + 歌名 (trans).lrc</option>
            </select>
          </FormField>
        </div>
      </section>

      <!-- Import / Export -->
      <section class="section-card overflow-hidden">
        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
          :class="collapsed.import ? 'border-b border-transparent' : 'border-b border-[var(--border-primary)]'"
          @click="toggle('import')"
        >
          <div>
            <h3 class="text-sm font-semibold">导入 / 导出配置</h3>
            <p class="text-2xs text-muted mt-0.5">JSON 格式，兼容旧 yunplex 配置</p>
          </div>
          <Chevron :open="!collapsed.import" />
        </div>
        <div v-show="!collapsed.import" class="p-5 space-y-4">
          <div class="flex gap-4">
            <label class="flex-1">
              <input
                ref="fileInput"
                type="file"
                accept=".json"
                class="hidden"
                @change="handleFileImport"
              />
              <button class="btn btn-secondary w-full" @click="($refs.fileInput as HTMLInputElement)?.click()">
                从文件导入...
              </button>
            </label>
            <button class="btn btn-secondary w-full" @click="showImportTextarea = !showImportTextarea">
              粘贴 JSON 导入
            </button>
            <button class="btn btn-secondary" @click="handleExport">
              导出
            </button>
          </div>

          <div v-if="showImportTextarea" class="space-y-3">
            <textarea
              v-model="importJson"
              class="form-input font-mono h-32"
              placeholder='粘贴完整配置 JSON 或旧 yunplex 格式...'
            />
            <div class="flex items-center gap-4">
              <button class="btn btn-primary" :disabled="!importJson || importing" @click="handleImportJson">
                {{ importing ? '导入中...' : '导入' }}
              </button>
              <span v-if="importResult" class="text-sm" :class="importResult.ok ? 'text-success' : 'text-danger'">
                {{ importResult.ok ? '✓' : '✗' }} {{ importResult.msg }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- Reset confirm dialog -->
    <ConfirmDialog
      :visible="showResetConfirm"
      title="恢复默认配置"
      message="此操作将把所有配置重置为默认值，当前配置将被覆盖。确定继续？"
      confirm-label="恢复默认"
      variant="danger"
      @confirm="handleReset"
      @cancel="showResetConfirm = false"
    />

  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { PATH_PRESETS } from '~~/server/lib/config/types'

const pathPresets = PATH_PRESETS

const pathVarHelp = [
  { key: 'artist', desc: '专辑艺人，如 Don Toliver' },
  { key: 'album', desc: '专辑名，如 Love Sick' },
  { key: 'year', desc: '发行年份，如 2023（无数据时为空）' },
  { key: 'track', desc: '曲目编号，如 3' },
  { key: 'track:02d', desc: '曲目编号补零，如 03' },
  { key: 'title', desc: '歌曲名，如 Lose My Mind' },
]

const pathFormatMode = computed({
  get: () => {
    const v = form.value?.other?.pathFormat
    if (!v) return '__custom__'
    return PATH_PRESETS.some(p => p.value === v) ? v : '__custom__'
  },
  set: (val: string) => {
    if (!form.value) return
    form.value.other.pathFormat = val === '__custom__' ? '' : val
  },
})

const api = useApi()

const loading = ref(true)
const saving = ref(false)
const showResetConfirm = ref(false)
const form = ref<AppConfig | null>(null)
const testing = ref<string | null>(null)
const saveMsg = ref<string | null>(null)
const saveOk = ref(true)
const testResult = ref<Record<string, { ok: boolean; msg: string }>>({})

// ── Collapsible sections ──
type SectionKey = 'netease' | 'plex' | 'download' | 'sync' | 'other' | 'import'
const collapsed = ref<Partial<Record<SectionKey, boolean>>>({})

const allExpanded = computed(() => {
  const keys: SectionKey[] = ['netease', 'plex', 'download', 'sync', 'other', 'import']
  return keys.every((k) => !collapsed.value[k])
})

function toggle(key: SectionKey) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
}

function toggleAll() {
  if (allExpanded.value) {
    collapsed.value = { netease: true, plex: true, download: true, sync: true, other: true, import: true }
  } else {
    collapsed.value = {}
  }
}

const playlistIdsText = computed({
  get: () => form.value?.netease.playlistIds.join(', ') ?? '',
  set: (val: string) => {
    if (form.value) {
      const ids = val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      form.value.netease.playlistIds = ids
    }
  },
})

async function loadConfig() {
  loading.value = true
  try {
    form.value = await api.get<AppConfig>('/config')
  } catch {
    form.value = { ...DEFAULT_CONFIG }
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!form.value) return
  saving.value = true
  saveMsg.value = null
  try {
    await api.put<AppConfig>('/config', form.value)
    showSaveMsg(true, '配置已保存')
  } catch (err) {
    showSaveMsg(false, err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleReset() {
  showResetConfirm.value = false
  try {
    await api.put<AppConfig>('/config', DEFAULT_CONFIG)
    form.value = { ...DEFAULT_CONFIG }
    showSaveMsg(true, '已恢复默认配置')
  } catch { /* ignore */ }
}

async function testConnection(section: 'netease' | 'plex') {
  testing.value = section
  testResult.value = { ...testResult.value, [section]: undefined as unknown as { ok: boolean; msg: string } }
  try {
    await api.post('/config/test-connection', { section })
    testResult.value = { ...testResult.value, [section]: { ok: true, msg: '连接正常' } }
  } catch (err) {
    testResult.value = { ...testResult.value, [section]: { ok: false, msg: err instanceof Error ? err.message : '连接失败' } }
  } finally {
    testing.value = null
  }
}

function showSaveMsg(ok: boolean, msg: string) {
  saveOk.value = ok
  saveMsg.value = msg
  setTimeout(() => { saveMsg.value = null }, 4000)
}

// ── Import / Export ──

const showImportTextarea = ref(false)
const importJson = ref('')
const importing = ref(false)
const importResult = ref<{ ok: boolean; msg: string } | null>(null)

async function handleFileImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    await doImport(parsed)
  } catch (err) {
    importResult.value = { ok: false, msg: '文件解析失败: ' + (err instanceof Error ? err.message : 'JSON 格式错误') }
  } finally {
    input.value = ''
  }
}

async function handleImportJson() {
  if (!importJson.value) return
  try {
    const parsed = JSON.parse(importJson.value)
    await doImport(parsed)
  } catch (err) {
    importResult.value = { ok: false, msg: 'JSON 解析失败: ' + (err instanceof Error ? err.message : '格式错误') }
  }
}

async function doImport(data: unknown) {
  importing.value = true
  importResult.value = null
  try {
    await api.post('/config/import', data)
    importResult.value = { ok: true, msg: '配置导入成功' }
    importJson.value = ''
    showImportTextarea.value = false
    await loadConfig()
  } catch (err) {
    importResult.value = { ok: false, msg: '导入失败: ' + (err instanceof Error ? err.message : '未知错误') }
  } finally {
    importing.value = false
  }
}

function handleExport() {
  if (!form.value) return
  const blob = new Blob([JSON.stringify(form.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'yunplex2-config.json'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(loadConfig)
</script>
