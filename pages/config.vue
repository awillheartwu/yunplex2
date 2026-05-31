<template>
  <div class="space-y-8">
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
      <!-- Tab bar -->
      <div class="flex items-center gap-1">
        <button
          v-for="t in tabs" :key="t.key"
          class="px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer"
          :class="activeTab === t.key
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
            : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
          @click="activeTab = t.key"
        >{{ t.label }}</button>
      </div>

      <!-- ═══ Tab: 连接 ═══ -->
      <template v-if="activeTab === 'connection'">
        <!-- Netease -->
        <ConfigSection title="网易云音乐" description="用于获取歌单和歌曲下载链接的认证信息" :collapsed="!!collapsed.netease" @toggle="toggle('netease')">
          <template #icon><SidebarIcon name="music" :active="true" /></template>
          <FormField label="Cookie" hint="从浏览器开发者工具中复制网易云音乐的 Cookie" required>
            <input v-model="form.netease.cookie" type="password" placeholder="MUSIC_U=xxx; __csrf=xxx; ..." class="form-input font-mono" @focus="($event.target as HTMLInputElement).type='text'" @blur="($event.target as HTMLInputElement).type='password'" />
          </FormField>
          <div class="p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
            <p class="text-xs text-muted">歌单管理请前往「<NuxtLink to="/sources" class="text-accent hover:underline">歌单源</NuxtLink>」页面。</p>
          </div>
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
            <button class="btn btn-ghost btn-sm" :disabled="testing === 'netease'" @click="testConnection('netease')">
              {{ testing === 'netease' ? '测试中...' : '测试网易云连接' }}
            </button>
            <span v-if="testResult['netease']" class="text-sm" :class="testResult['netease'].ok ? 'text-success' : 'text-danger'">
              {{ testResult['netease'].ok ? '✓' : '✗' }} {{ testResult['netease'].msg }}
            </span>
          </div>
        </ConfigSection>

        <!-- Plex -->
        <ConfigSection title="Plex Media Server" description="连接 Plex 媒体服务器以同步歌单" :collapsed="!!collapsed.plex" @toggle="toggle('plex')">
          <template #icon><SidebarIcon name="sync" :active="true" /></template>
          <div class="grid grid-cols-2 gap-4">
            <FormField label="服务器地址" required><input v-model="form.plex.server" type="text" placeholder="192.168.1.100" class="form-input" /></FormField>
            <FormField label="端口" required><input v-model.number="form.plex.port" type="number" placeholder="32400" class="form-input" /></FormField>
          </div>
          <FormField label="Token (X-Plex-Token)" hint="在 Plex 网页版的 XML 响应中可以找到" required>
            <input v-model="form.plex.token" type="password" placeholder="your-plex-token" class="form-input font-mono" @focus="($event.target as HTMLInputElement).type='text'" @blur="($event.target as HTMLInputElement).type='password'" />
          </FormField>
          <FormField label="音乐库名称" hint="Plex 中存放音乐的库名称，用于刷新和同步">
            <input v-model="form.plex.section" type="text" placeholder="音乐" class="form-input" />
          </FormField>
          <div class="pt-1 flex items-center gap-4">
            <button class="btn btn-ghost btn-sm" :disabled="testing === 'plex'" @click="testConnection('plex')">{{ testing === 'plex' ? '测试中...' : '测试 Plex 连接' }}</button>
            <span v-if="testResult['plex']" class="text-sm" :class="testResult['plex'].ok ? 'text-success' : 'text-danger'">{{ testResult['plex'].ok ? '✓' : '✗' }} {{ testResult['plex'].msg }}</span>
          </div>
        </ConfigSection>
      </template>

      <!-- ═══ Tab: 下载 ═══ -->
      <template v-if="activeTab === 'download'">
      <!-- Download -->
      <ConfigSection title="下载与文件" description="歌曲文件的存储路径和元数据处理选项" :collapsed="!!collapsed.download" @toggle="toggle('download')">
        <template #icon><SidebarIcon name="download" :active="true" /></template>
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
      </ConfigSection>
      </template>

      <!-- ═══ Tab: 同步 ═══ -->
      <template v-if="activeTab === 'sync'">

      <!-- Sync strategy -->
      <ConfigSection title="同步策略" description="控制同步的频率和范围" :collapsed="!!collapsed.sync" @toggle="toggle('sync')">
        <template #icon><SidebarIcon name="play" :active="true" /></template>
        <div class="grid grid-cols-2 gap-4">
          <FormField label="同步间隔（分钟）" hint="建议 30-60 分钟"><input v-model.number="form.sync.intervalMinutes" type="number" min="1" max="1440" class="form-input" /></FormField>
          <FormField label="歌曲数量上限" hint="每次同步处理的歌曲数量，0 = 不限"><input v-model.number="form.sync.songLimit" type="number" min="0" max="10000" class="form-input" /></FormField>
          <FormField label="下载并发数" hint="同时下载几首歌，建议 3-5，过高可能被网易云限速"><input v-model.number="form.sync.downloadConcurrency" type="number" min="1" max="10" class="form-input" /></FormField>
          <FormField label="Plex 扫描重试次数" hint="下载完成后查 Plex 是否索引的重试次数"><input v-model.number="form.sync.plexScanRetries" type="number" min="1" max="20" class="form-input" /></FormField>
          <FormField label="Plex 扫描重试间隔（秒）" hint="每次重试的等待时间，默认 15s × 5 次 = 最长 75s"><input v-model.number="form.sync.plexScanRetryDelaySec" type="number" min="5" max="60" class="form-input" /></FormField>
        </div>
        <ToggleField v-model="form.sync.enabled" label="启用自动同步" hint="开启后将在后台按设定间隔自动同步歌单" />
        <ToggleField v-model="form.sync.forceFullCompare" label="始终全量对比" hint="每次同步都走完整对比流程，不跳过未变化的歌单。单个歌单源可覆盖此设置" />
        <template v-if="!form.sync.forceFullCompare">
          <div class="grid grid-cols-2 gap-4">
            <FormField label="连续跳过上限（次）" hint="连续跳过 N 次增量对比后自动触发全量。0=不限；单个歌单源可覆盖"><input v-model.number="form.sync.fullCompareAfterSkips" type="number" min="0" max="100" class="form-input" /></FormField>
            <FormField label="全量对比间隔（天）" hint="距上次全量超过 N 天后自动触发全量。0=不限；单个歌单源可覆盖"><input v-model.number="form.sync.fullCompareAfterDays" type="number" min="0" max="365" class="form-input" /></FormField>
            <FormField label="失败忽略阈值（次）" hint="下载或 Plex 匹配连续失败 N 次后，自动忽略该歌曲，不再重试。单个歌单源可点清除按钮重置"><input v-model.number="form.sync.maxFailureAttempts" type="number" min="1" max="20" class="form-input" /></FormField>
          </div>
        </template>
      </ConfigSection>

      <!-- Album Sync -->
      <ConfigSection title="专辑同步" description="收藏专辑的同步行为与默认策略" :collapsed="!!collapsed.album" @toggle="toggle('album')">
        <template #icon><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--accent)" stroke-width="1.3"/><circle cx="8" cy="8" r="3" fill="var(--accent)" opacity="0.3"/></svg></template>
        <div class="space-y-3">
          <ToggleField v-model="form.sync.autoDownloadAlbum" label="添加后自动下载" hint="添加收藏专辑源时自动触发全量下载" />
          <ToggleField v-model="form.sync.skipPlexPlaylist" label="默认不入 Plex 歌单" hint="全局默认仅下载不建歌单；单个专辑可单独覆盖" />
        </div>
      </ConfigSection>
      </template>

      <!-- ═══ Tab: 高级 ═══ -->
      <template v-if="activeTab === 'advanced'">

      <!-- Data Retention -->
      <ConfigSection title="数据保留" description="控制各类历史数据的自动清理周期" :collapsed="!!collapsed.retention" @toggle="toggle('retention')">
        <template #icon><SidebarIcon name="database" :active="true" /></template>
        <div class="grid grid-cols-2 gap-4">
          <FormField label="日志保留天数" hint="超过该天数的日志将在下次写日志时自动清理。另有 5,000 行硬上限兜底"><input v-model.number="form.sync.logRetentionDays" type="number" min="1" max="365" class="form-input" /></FormField>
          <FormField label="成功任务保留天数" hint="成功的同步记录保留天数，超期自动清理"><input v-model.number="form.sync.jobRetentionSuccessDays" type="number" min="1" max="365" class="form-input" /></FormField>
          <FormField label="失败任务保留天数" hint="失败或部分失败的记录保留更久，方便排查问题"><input v-model.number="form.sync.jobRetentionFailedDays" type="number" min="1" max="365" class="form-input" /></FormField>
          <FormField label="下载队列保留天数" hint="下载队列的临时记录保留天数，0 = 永不清除"><input v-model.number="form.sync.downloadTaskRetentionDays" type="number" min="0" max="365" class="form-input" /></FormField>
        </div>
      </ConfigSection>

      <!-- Other strategies -->
      <ConfigSection title="其他策略" description="细节行为控制" :collapsed="!!collapsed.other" @toggle="toggle('other')">
        <template #icon><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#818cf8" stroke-width="1.3"/><path d="M5.5 7.5h5M5.5 10h3" stroke="#818cf8" stroke-width="1.3" stroke-linecap="round"/></svg></template>
        <FormField label="字体缩放" hint="全局字体大小缩放，1.0 为默认 16px">
          <div class="flex items-center gap-3">
            <input v-model.number="form.other.fontScale" type="range" min="0.8" max="1.5" step="0.05" class="flex-1 accent-[#818cf8]" />
            <span class="text-xs text-muted w-10 text-right">{{ form.other.fontScale?.toFixed(2) }}x</span>
          </div>
        </FormField>
        <FormField label="存储路径格式">
          <template #hint>
            <span class="inline-flex items-center gap-1">
              <span>用 / 分隔目录层级</span>
              <span class="relative inline-flex group">
                <span class="text-accent cursor-help underline decoration-dotted underline-offset-2">变量说明</span>
                <div class="absolute top-full left-0 mt-1 w-72 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg p-3 text-2xs space-y-1.5 font-mono shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                  <p class="text-muted mb-2">可用变量（/ 表示新建一层目录）：</p>
                  <div v-for="v in pathVarHelp" :key="v.key" class="flex gap-4">
                    <code class="text-accent w-32 shrink-0">{{ '{' + v.key + '}' }}</code>
                    <span class="text-muted-deep">{{ v.desc }}</span>
                  </div>
                </div>
              </span>
            </span>
          </template>
          <select :value="pathFormatMode" class="form-input" @change="interceptPathFormatChange(($event.target as HTMLSelectElement).value)">
            <option v-for="p in pathPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
            <option value="__custom__">自定义...</option>
          </select>
          <input v-if="pathFormatMode === '__custom__'" :value="form.other.pathFormat" type="text" placeholder="{artist}/{album} ({year})/{track:02d} - {title}" class="form-input mt-2" @input="interceptPathFormatChange(($event.target as HTMLInputElement).value)" />
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
        <ToggleField v-model="form.other.downloadTranslatedLyric" label="下载翻译歌词" hint="关闭后只下载原文歌词，不合并翻译版本。仅对新下载的歌曲生效，已存在的歌曲不会自动补全" />
        <ToggleField v-model="form.other.downloadRomajiLyric" label="下载罗马音歌词" hint="日/韩语等歌曲的罗马音注音单独保存为 (romaji).lrc 文件，不与原文合并。仅对新下载的歌曲生效，已存在的歌曲不会自动补全" />
        <FormField v-if="form.other.downloadTranslatedLyric" label="双语歌词存储方式" hint="合并到一个文件或分开保存为两个文件">
          <select v-model="form.other.lyricOrder" class="form-input">
            <option value="original_first">合并：原文在上 / 翻译在下（翻译高亮）</option>
            <option value="translated_first">合并：翻译在上 / 原文在下（原文高亮）</option>
            <option value="separate">分开存储：歌名 (orgi).lrc + 歌名 (trans).lrc</option>
          </select>
        </FormField>
      </ConfigSection>

      <!-- Import / Export -->
      <ConfigSection title="导入 / 导出配置" description="JSON 格式，兼容旧 yunplex 配置" :collapsed="!!collapsed.import" @toggle="toggle('import')">
        <template #icon><SidebarIcon name="import-export" :active="true" /></template>
        <div class="flex gap-4">
          <label class="flex-1">
            <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileImport" />
            <button class="btn btn-secondary w-full" @click="($refs.fileInput as HTMLInputElement)?.click()">从文件导入...</button>
          </label>
          <button class="btn btn-secondary w-full" @click="showImportTextarea = !showImportTextarea">粘贴 JSON 导入</button>
          <button class="btn btn-secondary" @click="handleExport(form)">导出</button>
        </div>
        <div v-if="showImportTextarea" class="space-y-3">
          <textarea v-model="importJson" class="form-input font-mono h-32" placeholder="粘贴完整配置 JSON 或旧 yunplex 格式..." />
          <div class="flex items-center gap-4">
            <button class="btn btn-primary" :disabled="!importJson || importing" @click="handleImportJson">{{ importing ? '导入中...' : '导入' }}</button>
            <span v-if="importResult" class="text-sm" :class="importResult.ok ? 'text-success' : 'text-danger'">{{ importResult.ok ? '✓' : '✗' }} {{ importResult.msg }}</span>
          </div>
        </div>
      </ConfigSection>
      </template>
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

    <!-- Path format change warning -->
    <ConfirmDialog
      :visible="showPathFormatConfirm"
      title="更改存储路径格式"
      confirm-label="我已知晓，确认更改"
      variant="danger"
      @confirm="confirmPathFormatChange"
      @cancel="cancelPathFormatChange"
    >
      <div class="space-y-4 mb-6">
        <!-- Warning banner -->
        <div class="flex items-start gap-3 p-3 rounded-lg border" style="border-color:var(--warning,#f59e0b);background:rgba(245,158,11,0.08)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="shrink-0 mt-0.5"><path d="M8 2l7 12H1L8 2z" stroke="var(--warning,#f59e0b)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 7v2M8 11v1" stroke="var(--warning,#f59e0b)" stroke-width="1.5" stroke-linecap="round"/></svg>
          <div class="text-xs" style="color:var(--warning,#f59e0b)">
            <p class="font-semibold mb-1">此操作不可逆，系统不会自动迁移已有文件</p>
          </div>
        </div>

        <!-- Consequences list -->
        <div class="text-xs space-y-3" style="color:var(--text-secondary)">
          <p>更改后会发生以下情况：</p>
          <ol class="space-y-2 list-decimal pl-4">
            <li><span class="text-[var(--text-primary)] font-medium">已有歌曲文件保留在原路径</span>，不会被移动或删除，但系统无法再定位它们。</li>
            <li><span class="font-medium" style="color:var(--danger,#e74c3c)">尚未同步到 Plex 的歌曲将被重新下载</span>到新路径，造成磁盘空间浪费。</li>
            <li>歌词文件（<code class="px-1 py-0.5 rounded text-2xs" style="background:var(--bg-input)">.lrc</code>）和封面图（<code class="px-1 py-0.5 rounded text-2xs" style="background:var(--bg-input)">cover.jpg</code>）与音频文件同目录存放，路径变更后同样无法定位。</li>
          </ol>

          <div class="p-3 rounded-lg border" style="border-color:var(--accent);background:var(--accent-muted)">
            <p class="font-medium mb-1" style="color:var(--accent)">建议</p>
            <p class="text-muted-deep">更改前，确保所有歌曲已经同步到 Plex（可在首页手动触发一次全量同步），这样后续同步时 Plex 库中的记录可作为索引，避免重复下载。</p>
          </div>
        </div>
      </div>
    </ConfirmDialog>

  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { PATH_PRESETS } from '~~/server/lib/config/types'
import { useConfigImport } from '~~/composables/useConfigImport'

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

// ── Path format change warning ──
const showPathFormatConfirm = ref(false)
const pendingPathFormat = ref('')

function interceptPathFormatChange(newValue: string) {
  const oldValue = form.value?.other?.pathFormat
  if (!oldValue) {
    // First time setting — no warning needed
    pathFormatMode.value = newValue
    return
  }
  if (newValue === oldValue || (newValue === '__custom__' && oldValue === '')) return
  pendingPathFormat.value = newValue
  showPathFormatConfirm.value = true
}

function confirmPathFormatChange() {
  pathFormatMode.value = pendingPathFormat.value
  showPathFormatConfirm.value = false
}

function cancelPathFormatChange() {
  showPathFormatConfirm.value = false
}

const api = useApi()

const loading = ref(true)
const saving = ref(false)
const showResetConfirm = ref(false)
const form = ref<AppConfig | null>(null)
const testing = ref<string | null>(null)
const saveMsg = ref<string | null>(null)
const saveOk = ref(true)
const testResult = ref<Record<string, { ok: boolean; msg: string }>>({})

// ── Tab navigation ──
const activeTab = ref<string>('connection')
const tabs = [
  { key: 'connection', label: '连接' },
  { key: 'sync',       label: '同步' },
  { key: 'download',   label: '下载' },
  { key: 'advanced',   label: '高级' },
]

// ── Collapsible sections ──
type SectionKey = 'netease' | 'plex' | 'download' | 'sync' | 'album' | 'retention' | 'other' | 'import'
const collapsed = ref<Partial<Record<SectionKey, boolean>>>({})

const allExpanded = computed(() => {
  const keys: SectionKey[] = ['netease', 'plex', 'download', 'sync', 'album', 'retention', 'other', 'import']
  return keys.every((k) => !collapsed.value[k])
})

function toggle(key: SectionKey) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
}

function toggleAll() {
  if (allExpanded.value) {
    collapsed.value = { netease: true, plex: true, download: true, sync: true, album: true, retention: true, other: true, import: true }
  } else {
    collapsed.value = {}
  }
}



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
const { showImportTextarea, importJson, importing, importResult, handleFileImport, handleImportJson, handleExport } = useConfigImport(loadConfig)

onMounted(loadConfig)
</script>
