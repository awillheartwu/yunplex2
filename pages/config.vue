<template>
  <div class="page-stack config-page">
    <PageHeader
      description="管理网易云音乐和 Plex 的连接、下载与同步策略"
    >
      <template #actions><NuxtLink to="/system" class="btn btn-secondary"><AppIcon name="activity" :size="15" />查看系统状态</NuxtLink></template>
    </PageHeader>
    <div class="config-workspace">
    <section class="settings-directory" aria-label="设置导航">
      <label class="settings-search"><AppIcon name="search" :size="16" /><input v-model="categorySearch" type="search" class="form-input" placeholder="查找设置分类…" aria-label="查找设置分类"></label>
      <PageTabs v-if="visibleSettingsTabs.length" class="config-navigation" :model-value="activeTab" :tabs="visibleSettingsTabs" aria-label="设置分类" @update:model-value="activeTab = $event" />
      <p v-if="!visibleSettingsTabs.length" class="settings-no-results" role="status">没有匹配分类，请调整搜索词。</p>
      <label class="settings-mobile-category" for="settings-category-select"><span>设置分类</span><select id="settings-category-select" v-model="activeTab" class="form-input"><option v-for="tab in tabs" :key="tab.key" :value="tab.key">{{ tab.label }}</option></select></label>
    </section>
    <div class="config-content">
    <div class="settings-category-intro"><h2>{{ tabs.find(tab => tab.key === activeTab)?.label }}</h2><p>{{ categoryDescriptions[activeTab] }}</p></div>
    <div v-if="configLoadError" class="section-card config-load-error" role="alert"><h2>无法读取配置</h2><p>{{ configLoadError }}</p><button class="btn btn-secondary" @click="loadConfig">重新加载</button></div>
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-muted text-sm">加载配置...</span>
    </div>
    <!-- Form -->
    <template v-else-if="form">
      <!-- ═══ Tab: 连接 ═══ -->
      <template v-if="activeTab === 'general'">
        <!-- Netease -->
        <ConfigSection title="网易云音乐" description="用于获取歌单和歌曲下载链接的认证信息" :collapsed="!!collapsed.netease" @toggle="toggle('netease')">
          <template #icon><SidebarIcon name="music" :active="true" /></template>
          <FormField label="Cookie" hint="从浏览器开发者工具中复制网易云音乐的 Cookie" required>
            <input v-model="form.netease.cookie" type="password" placeholder="MUSIC_U=xxx; __csrf=xxx; ..." class="form-input font-mono" @focus="($event.target as HTMLInputElement).type='text'" @blur="($event.target as HTMLInputElement).type='password'" />
          </FormField>
          <div class="p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
            <p class="text-xs text-muted">来源管理请前往「<NuxtLink to="/sync-sources" class="text-accent hover:underline">同步源</NuxtLink>」页面。</p>
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
            <button type="button" class="btn btn-ghost btn-sm" :disabled="testing === 'netease'" @click="testConnection('netease')">
              {{ testing === 'netease' ? '测试中...' : '测试网易云连接' }}
            </button>
            <span v-if="testResult['netease']" class="inline-flex items-center gap-1 text-sm" :class="testResultClass(testResult['netease'])" role="status" aria-live="polite">
              <AppIcon :name="testResultIcon(testResult['netease'])" :size="14" />
              {{ testResult['netease'].msg }}
            </span>
          </div>
        </ConfigSection>
        <!-- Plex -->
        <ConfigSection title="Plex Media Server" description="连接 Plex 媒体服务器以同步歌单" :collapsed="!!collapsed.plex" @toggle="toggle('plex')">
          <template #icon><SidebarIcon name="sync" :active="true" /></template>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <button type="button" class="btn btn-ghost btn-sm" :disabled="testing === 'plex'" @click="testConnection('plex')">{{ testing === 'plex' ? '测试中...' : '测试 Plex 连接' }}</button>
            <span v-if="testResult['plex']" class="inline-flex items-center gap-1 text-sm" :class="testResultClass(testResult['plex'])" role="status" aria-live="polite">
              <AppIcon :name="testResultIcon(testResult['plex'])" :size="14" />
              {{ testResult['plex'].msg }}
            </span>
          </div>
          <StorageVisibilityDiagnostic v-if="storageDiagnostic" :diagnostic="storageDiagnostic" />
        </ConfigSection>
      </template>

      <!-- ═══ Tab: 下载 ═══ -->
      <template v-if="activeTab === 'media'">
      <!-- Download -->
      <ConfigSection title="下载与文件" description="歌曲文件的存储路径和元数据处理选项" :collapsed="!!collapsed.download" @toggle="toggle('download')">
        <template #icon><SidebarIcon name="download" :active="true" /></template>
        <FormField label="下载目录" hint="下载的歌曲将按 艺术家/专辑 的结构存放在此目录" required>
          <input v-model="form.download.dir" type="text" placeholder="/mnt/nas" class="form-input" />
        </FormField>
        <FormField label="Plex 音乐库路径前缀" hint="填写 Plex 在自己的运行环境中看到的音乐根目录。它用于同一文件的双向路径换算。">
          <input v-model="form.download.plexLibraryPathPrefix" type="text" placeholder="/music" class="form-input" />
        </FormField>
        <div class="path-mapping-disclosure" role="note">
          <AppIcon name="info" :size="15" />
          <p><strong>路径映射不会传输文件。</strong>它只把本地路径换算成 Plex 路径；若 Plex 在另一台主机，下载目录必须是同一共享挂载，或另有明确的复制/发布流程。</p>
        </div>
        <div class="pt-1 flex items-center gap-4">
          <button type="button" class="btn btn-ghost btn-sm" :disabled="testing === 'download'" @click="testConnection('download')">
            {{ testing === 'download' ? '测试中...' : '测试下载路径' }}
          </button>
          <span v-if="testResult['download']" class="inline-flex items-center gap-1 text-sm" :class="testResultClass(testResult['download'])" role="status" aria-live="polite">
            <AppIcon :name="testResultIcon(testResult['download'])" :size="14" />
            {{ testResult['download'].msg }}
          </span>
        </div>
        <StorageVisibilityDiagnostic v-if="storageDiagnostic" :diagnostic="storageDiagnostic" />
        <div class="space-y-3">
          <ToggleField v-model="form.download.downloadLyrics" label="下载歌词" hint="下载 .lrc 歌词文件与歌曲放在一起" />
          <ToggleField v-model="form.download.embedMetadata" label="写入元数据标签" hint="将歌曲名、艺术家、专辑等信息写入 ID3/FLAC 标签" />
          <ToggleField v-model="form.download.embedCover" label="嵌入封面图" hint="将专辑封面嵌入到音频文件中" />
          <ToggleField v-model="form.download.saveAlbumCover" label="保存专辑封面" hint="将专辑封面保存为 cover.jpg 到专辑文件夹" />
          <ToggleField v-model="form.download.saveArtistImage" label="保存歌手图片" hint="将歌手头像保存为 artist.jpg 到歌手文件夹（首次下载后不覆盖）" />
        </div>
      </ConfigSection>

      <ConfigSection title="文件命名与歌词" description="下载产物的目录格式、歌词版本和艺人写入方式" :collapsed="!!collapsed.filePolicy" @toggle="toggle('filePolicy')">
        <template #icon><SidebarIcon name="folder" :active="true" /></template>
        <FormField label="存储路径格式">
          <template #hint>
            <span class="inline-flex items-center gap-1">
              <span>用 / 分隔目录层级</span>
              <span class="relative inline-flex group">
                <span class="text-accent cursor-help underline decoration-dotted underline-offset-2">变量说明</span>
                <div class="absolute top-full left-0 mt-1 w-72 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg p-3 text-2xs space-y-1.5 font-mono shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[var(--z-modal)] pointer-events-none">
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
          <input v-if="pathFormatMode === '__custom__'" :value="form.other.pathFormat" type="text" placeholder="{artist}/{album} ({year})/{track:02d} - {title}" class="form-input mt-2" @input="updateCustomPathFormat(($event.target as HTMLInputElement).value)" />
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
        <div class="space-y-3">
          <ToggleField v-model="form.other.downloadTranslatedLyric" label="下载翻译歌词" hint="关闭后只下载原文歌词，不合并翻译版本。仅对新下载的歌曲生效，已存在的歌曲不会自动补全" />
          <ToggleField v-model="form.other.downloadRomajiLyric" label="下载罗马音歌词" hint="日/韩语等歌曲的罗马音注音单独保存为 (romaji).lrc 文件，不与原文合并。仅对新下载的歌曲生效，已存在的歌曲不会自动补全" />
        </div>
        <FormField v-if="form.other.downloadTranslatedLyric" label="双语歌词存储方式" hint="合并到一个文件或分开保存为两个文件">
          <select v-model="form.other.lyricOrder" class="form-input">
            <option value="original_first">合并：原文在上 / 翻译在下（翻译高亮）</option>
            <option value="translated_first">合并：翻译在上 / 原文在下（原文高亮）</option>
            <option value="separate">分开存储：歌名 (orgi).lrc + 歌名 (trans).lrc</option>
          </select>
        </FormField>
      </ConfigSection>

      <button class="btn btn-secondary" @click="activeTab = 'artists'">管理艺人名称与写入替换<AppIcon name="arrowRight" :size="16" /></button>
      </template>

      <!-- ═══ Tab: 同步 ═══ -->
      <!-- Sync strategy -->
      <!-- Sync schedule -->
      <ConfigSection v-if="activeTab === 'sync'" title="同步调度" description="控制自动同步的间隔和资源占用" :collapsed="!!collapsed.schedule" @toggle="toggle('schedule')">
        <template #icon><SidebarIcon name="play" :active="true" /></template>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="同步间隔（分钟）" hint="建议 30-60 分钟"><input v-model.number="form.sync.intervalMinutes" type="number" min="1" max="1440" class="form-input" /></FormField>
          <FormField label="歌曲数量上限" hint="每次同步处理的歌曲数量，0 = 不限"><input v-model.number="form.sync.songLimit" type="number" min="0" max="10000" class="form-input" /></FormField>
          <FormField label="下载并发数" hint="同时下载几首歌，建议 3-5，过高可能被网易云限速"><input v-model.number="form.sync.downloadConcurrency" type="number" min="1" max="10" class="form-input" /></FormField>
        </div>
        <ToggleField v-model="form.sync.enabled" label="启用自动同步" hint="开启后将在后台按设定间隔自动同步歌单" />
      </ConfigSection>

      <!-- Sync strategy -->
      <ConfigSection v-if="activeTab === 'sync'" title="同步策略" description="对比、重试和删除保护等低频行为" :collapsed="!!collapsed.sync" @toggle="toggle('sync')">
        <template #icon><SidebarIcon name="sync" :active="true" /></template>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Plex 扫描重试次数" hint="下载完成后查 Plex 是否索引的重试次数"><input v-model.number="form.sync.plexScanRetries" type="number" min="1" max="20" class="form-input" /></FormField>
          <FormField label="Plex 扫描重试间隔（秒）" hint="每次重试的等待时间，默认 15s × 5 次 = 最长 75s"><input v-model.number="form.sync.plexScanRetryDelaySec" type="number" min="5" max="60" class="form-input" /></FormField>
        </div>
        <ToggleField v-model="form.sync.forceFullCompare" label="始终全量对比" hint="每次同步都走完整对比流程，不跳过未变化的歌单。单个歌单源可覆盖此设置" />
        <ToggleField v-model="form.sync.reconcileOnPlexDrift" label="自动修复 Plex 侧漂移" hint="网易云未变化但 Plex 歌单被手动改动时，自动进入全量对齐" />
        <template v-if="!form.sync.forceFullCompare">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="连续跳过上限（次）" hint="连续跳过 N 次增量对比后自动触发全量。0=不限；单个歌单源可覆盖"><input v-model.number="form.sync.fullCompareAfterSkips" type="number" min="0" max="100" class="form-input" /></FormField>
            <FormField label="全量对比间隔（天）" hint="距上次全量超过 N 天后自动触发全量。0=不限；单个歌单源可覆盖"><input v-model.number="form.sync.fullCompareAfterDays" type="number" min="0" max="365" class="form-input" /></FormField>
            <FormField label="连续失败阈值（次）" hint="下载或标签连续失败 N 次后暂停自动重试；可从异常处理或同步源主动重试"><input v-model.number="form.sync.maxFailureAttempts" type="number" min="1" max="20" class="form-input" /></FormField>
          </div>
        </template>
        <ToggleField v-model="form.sync.skipRemoveExtraTracks" label="不删除 Plex 多余歌曲" hint="同步时只添加和重排，不删除 Plex 中网易云已移除的歌曲。单个歌单源可覆盖此设置" />
        <fieldset v-if="!form.sync.skipRemoveExtraTracks" class="removal-policy" aria-describedby="removal-policy-help">
          <legend class="removal-policy__legend">多余歌曲清理策略</legend>
          <p id="removal-policy-help" class="removal-policy__help">
            这里只移除 Plex 歌单中的条目，不会删除音乐库文件。目标不完整、身份冲突和写入失败始终受保护。
          </p>
          <div class="removal-policy__options">
            <label
              v-for="option in extraTrackRemovalPolicyOptions"
              :key="option.value"
              class="removal-policy__option"
              :class="{ 'removal-policy__option--selected': form.sync.extraTrackRemovalPolicy === option.value }"
            >
              <input
                v-model="form.sync.extraTrackRemovalPolicy"
                type="radio"
                name="extra-track-removal-policy"
                :value="option.value"
              >
              <span class="removal-policy__content">
                <span class="removal-policy__title-row">
                  <strong>{{ option.label }}</strong>
                  <span v-if="option.recommended" class="removal-policy__badge">推荐</span>
                </span>
                <span class="removal-policy__description">{{ option.description }}</span>
              </span>
            </label>
          </div>
          <div
            v-if="form.sync.extraTrackRemovalPolicy === 'exact'"
            class="removal-policy__warning"
            role="status"
          >
            <AppIcon name="warn" :size="15" />
            <span>精确对齐会在单次完整同步中立即移除未知旧条目。适合完全由网易云维护的 Plex 歌单。</span>
          </div>
        </fieldset>
      </ConfigSection>

      <ConfigSection v-if="activeTab === 'sync'" title="首次媒体接管" description="首次同步前先分析现有 Plex 媒体并等待人工确认" :collapsed="!!collapsed.initialMedia" @toggle="toggle('initialMedia')">
        <ToggleField
          v-model="form.sync.initializeMediaOnFirstSync"
          label="首次同步前启用媒体接管"
          hint="只生成候选方案，不下载也不修改 Plex；每个歌单可在详情页继承或覆盖此设置"
        />
      </ConfigSection>

      <ConfigSection v-if="activeTab === 'sync'" title="未验证媒体" description="没有强身份可复用时，决定自动下载还是留给人工选择" :collapsed="!!collapsed.mediaPolicy" @toggle="toggle('mediaPolicy')">
        <template #icon><SidebarIcon name="search" :active="true" /></template>
        <fieldset class="removal-policy" aria-describedby="unverified-media-policy-help">
          <legend class="removal-policy__legend">默认处理方式</legend>
          <p id="unverified-media-policy-help" class="removal-policy__help">
            自动匹配仍只接受人工关联或 YunPlex 托管文件的精确路径；这里不调整匹配宽容度。
          </p>
          <div class="removal-policy__options removal-policy__options--two">
            <label
              v-for="option in unverifiedMediaPolicyOptions"
              :key="option.value"
              class="removal-policy__option"
              :class="{ 'removal-policy__option--selected': form.sync.unverifiedMediaPolicy === option.value }"
            >
              <input
                v-model="form.sync.unverifiedMediaPolicy"
                type="radio"
                name="unverified-media-policy"
                :value="option.value"
              >
              <span class="removal-policy__content">
                <span class="removal-policy__title-row">
                  <strong>{{ option.label }}</strong>
                  <span v-if="option.recommended" class="removal-policy__badge">推荐</span>
                </span>
                <span class="removal-policy__description">{{ option.description }}</span>
              </span>
            </label>
          </div>
        </fieldset>
      </ConfigSection>

      <!-- Album Sync -->
      <ConfigSection v-if="activeTab === 'sync'" title="专辑同步" description="收藏专辑的下载行为与默认产物" :collapsed="!!collapsed.album" @toggle="toggle('album')">
        <template #icon><SidebarIcon name="album" :active="true" /></template>
        <div class="space-y-3">
          <ToggleField v-model="form.sync.autoDownloadAlbum" label="添加后自动下载" hint="添加收藏专辑源时自动触发全量下载" />
          <ToggleField v-model="form.sync.skipPlexPlaylist" label="默认不入 Plex 歌单" hint="全局默认仅下载不建歌单；单个专辑可单独覆盖" />
        </div>
      </ConfigSection>
      <!-- ═══ Tab: 偏好 ═══ -->
      <template v-if="activeTab === 'matching'">
        <InitializationMatchingSettings
          v-model="matchingConfig"
          :saved-config="savedMatchingConfig"
          @open-artist-names="activeTab = 'artists'"
        />
      </template>

      <ArtistNamesSettings v-show="activeTab === 'artists'" v-model:apply-to-album="form.other.applyAliasToAlbum" :matching="matchingConfig.artistAliases" :replacements="form.other.artistAliases" :matching-active="matchingConfig.enabled && matchingConfig.useArtistAliases" :reset-key="form" :disabled="saving" @update="applyArtistNames" @invalid="artistNamesError = $event" />
      <p v-if="artistNamesError && activeTab !== 'artists'" role="alert">艺人名称规则尚未完成。<button class="btn btn-secondary" @click="activeTab = 'artists'">返回修正</button></p>
      <template v-if="activeTab === 'display'">
      <ConfigSection title="界面" description="调整管理界面的显示大小" :collapsed="!!collapsed.other" @toggle="toggle('other')">
        <template #icon><SidebarIcon name="settings" :active="true" /></template>
        <FormField label="字体缩放" hint="按比例调整文字与控件，1.0 为标准大小（正文 14px）">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div class="flex w-full max-w-xl items-center gap-3">
              <input
                v-model.number="form.other.fontScale"
                type="range"
                min="0.8"
                max="1.5"
                step="0.05"
                class="w-full accent-[var(--accent)]"
                aria-label="字体缩放"
              />
              <span class="w-12 shrink-0 text-right text-xs text-muted">{{ form.other.fontScale?.toFixed(2) }}x</span>
            </div>
            <div class="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2">
              <span class="shrink-0 text-2xs font-medium text-muted-deep">预览</span>
              <span
                class="font-semibold text-[var(--text-primary)]"
                :style="{ fontSize: `${Math.round((form.other.fontScale || 1) * 16)}px`, lineHeight: '1.25' }"
              >
                示例文字 Aa 123
              </span>
            </div>
          </div>
        </FormField>
      </ConfigSection>
      </template>

      <!-- ═══ Tab: 高级 ═══ -->
      <template v-if="activeTab === 'advanced'">

      <ConfigSection title="安全" description="管理员密码与登录状态" :collapsed="!!collapsed.security" @toggle="toggle('security')">
        <template #icon><SidebarIcon name="shield" :active="true" /></template>
        <form class="space-y-4" @submit.prevent="handleChangePassword">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField label="当前密码" required>
              <input v-model="passwordForm.current" type="password" autocomplete="current-password" class="form-input" :disabled="changingPassword" />
            </FormField>
            <FormField label="新密码" hint="至少 8 个字符" required>
              <input v-model="passwordForm.next" type="password" autocomplete="new-password" class="form-input" :disabled="changingPassword" />
            </FormField>
            <FormField label="确认新密码" required>
              <input v-model="passwordForm.confirm" type="password" autocomplete="new-password" class="form-input" :disabled="changingPassword" />
            </FormField>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button class="btn btn-secondary btn-sm" type="submit" :disabled="changingPassword || !passwordForm.current || !passwordForm.next || !passwordForm.confirm">
              <AppIcon v-if="changingPassword" name="loader" class="animate-spin" :size="15" />
              <AppIcon v-else name="save" :size="15" />
              {{ changingPassword ? '修改中...' : '修改管理员密码' }}
            </button>
            <p class="text-2xs text-muted-deep">修改成功后会撤销全部登录状态，需要重新登录。</p>
          </div>
        </form>
      </ConfigSection>

      <!-- Data Retention -->
      <ConfigSection title="数据保留" description="控制各类历史数据的自动清理周期" :collapsed="!!collapsed.retention" @toggle="toggle('retention')">
        <template #icon><SidebarIcon name="database" :active="true" /></template>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="诊断日志保留天数" hint="由系统维护定期清理，最长 30 天，最多保留 2,000 条"><input v-model.number="form.sync.logRetentionDays" type="number" min="1" max="30" class="form-input" /></FormField>
          <FormField label="成功运行保留天数" hint="成功或取消记录最多保留 7 天"><input v-model.number="form.sync.jobRetentionSuccessDays" type="number" min="1" max="7" class="form-input" /></FormField>
          <FormField label="失败运行保留天数" hint="完整歌曲详情保留 14 天，运行摘要最多保留 30 天"><input v-model.number="form.sync.jobRetentionFailedDays" type="number" min="14" max="30" class="form-input" /></FormField>
          <FormField label="下载任务保留天数" hint="已完成任务最多保留 30 天；未解决异常所需的重试任务不会被清理"><input v-model.number="form.sync.downloadTaskRetentionDays" type="number" min="1" max="30" class="form-input" /></FormField>
        </div>
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
          <textarea v-model="importJson" class="form-input font-mono" placeholder="粘贴完整配置 JSON 或旧 yunplex 格式..." />
          <div class="flex items-center gap-4">
            <button class="btn btn-primary" :disabled="!importJson || importing" @click="handleImportJson">{{ importing ? '导入中...' : '导入' }}</button>
            <span v-if="importResult" class="inline-flex items-center gap-1 text-sm" :class="importResult.ok ? 'text-success' : 'text-danger'">
              <AppIcon :name="importResult.ok ? 'check' : 'x'" :size="14" />
              {{ importResult.msg }}
            </span>
          </div>
        </div>
      </ConfigSection>

      <ConfigSection title="危险操作" description="仅在需要恢复或重新验证整套配置时使用" :collapsed="!!collapsed.danger" @toggle="toggle('danger')">
        <template #icon><SidebarIcon name="warn" :active="true" /></template>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div class="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-4">
            <h4 class="text-[var(--text-primary)]">恢复默认配置</h4>
            <p class="mt-1 text-2xs text-muted">覆盖当前连接、下载和同步设置，不删除媒体或运行数据。</p>
            <button type="button" class="btn btn-danger btn-sm mt-3" @click="showResetConfirm = true">恢复默认</button>
          </div>
          <div class="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-4">
            <h4 class="text-[var(--text-primary)]">重新初始化</h4>
            <p class="mt-1 text-2xs text-muted">保留配置和管理员密码，重新进入 setup 并验证三个必需条件。</p>
            <button class="btn btn-danger btn-sm mt-3" type="button" :disabled="reinitializing" @click="showReinitializeConfirm = true">
              {{ reinitializing ? '处理中...' : '进入重新初始化' }}
            </button>
          </div>
        </div>
      </ConfigSection>
      </template>
    </template>

    </div>
    </div>
    <ConfigSaveBar :changed="hasChanges" :saving="saving" :disabled="!form || loading || !!artistNamesError" @save="handleSave" @discard="discardConfig" />
    <UnsavedChangesGuard :dirty="hasChanges" :saving="saving" />
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

    <ConfirmDialog
      :visible="showReinitializeConfirm"
      title="重新初始化"
      message="此操作会让应用重新进入 setup 流程。现有配置和管理员密码会保留，但完成前无法进入正式控制台。确定继续？"
      confirm-label="重新初始化"
      variant="danger"
      @confirm="handleReinitialize"
      @cancel="showReinitializeConfirm = false"
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
        <div class="flex items-start gap-3 p-3 rounded-lg border" style="border-color:var(--warning);background:var(--warning-soft)">
          <AppIcon name="warn" :size="16" class="shrink-0 mt-0.5" />
          <div class="text-xs" style="color:var(--warning)">
            <p class="font-semibold mb-1">此操作不可逆，系统不会自动迁移已有文件</p>
          </div>
        </div>

        <!-- Consequences list -->
        <div class="text-xs space-y-3" style="color:var(--text-secondary)">
          <p>更改后会发生以下情况：</p>
          <ol class="space-y-2 list-decimal pl-4">
            <li><span class="text-[var(--text-primary)] font-medium">已有歌曲文件保留在原路径</span>，不会被移动或删除，但系统无法再定位它们。</li>
            <li><span class="font-medium" style="color:var(--danger)">尚未同步到 Plex 的歌曲将被重新下载</span>到新路径，造成磁盘空间浪费。</li>
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
import type { ArtistNameSettings } from '~~/shared/artist-names'
import { tabs, categoryDescriptions } from '~/lib/settings-navigation'
import { useAppearance } from '~/composables/useAppearance'
const appearance = useAppearance()
import type { AppConfig, StorageVisibilityDiagnostic as StorageVisibilityDiagnosticType } from '~~/server/lib/config/types'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { PATH_PRESETS } from '~~/server/lib/config/types'
import { DEFAULT_INITIALIZATION_MATCHING, type InitializationMatchingConfig } from '~~/shared/initialization-matching'
import { useConfigImport } from '~~/composables/useConfigImport'
import { useFeedback } from '~~/composables/useFeedback'

const pathPresets = PATH_PRESETS
const extraTrackRemovalPolicyOptions = [
  {
    value: 'strict',
    label: '严格保护',
    description: '仅删除已有强身份的旧条目；无法审计身份的历史条目持续保留。',
    recommended: false,
  },
  {
    value: 'balanced',
    label: '平衡清理',
    description: '完整目标下连续两轮确认仍为多余项后自动移除，兼顾安全与自动收敛。',
    recommended: true,
  },
  {
    value: 'exact',
    label: '精确对齐',
    description: '完整目标确认后立即移除所有多余歌单项，最快保持两端完全一致。',
    recommended: false,
  },
] as const
const unverifiedMediaPolicyOptions = [
  {
    value: 'download_managed',
    label: '自动下载并托管',
    description: '未找到强身份时下载独立副本；Plex 按精确路径索引后自动建立托管关联。',
    recommended: true,
  },
  {
    value: 'wait_manual',
    label: '等待手动选择',
    description: '不自动下载，留在同步源详情中；可选择 Plex 现有媒体，或单独下载并托管。',
    recommended: false,
  },
] as const
const pathVarHelp = [
  { key: 'artist', desc: '专辑艺人，如 Don Toliver' },
  { key: 'album', desc: '专辑名，如 Love Sick' },
  { key: 'year', desc: '发行年份，如 2023（无数据时为空）' },
  { key: 'track', desc: '曲目编号，如 3' },
  { key: 'track:02d', desc: '曲目编号补零，如 03' },
  { key: 'title', desc: '歌曲名，如 Lose My Mind' },
  { key: 'songId', desc: '网易云歌曲 ID，用于稳定识别托管文件' },
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

function updateCustomPathFormat(newValue: string) {
  if (!form.value) return
  form.value.other.pathFormat = newValue
}

function confirmPathFormatChange() {
  pathFormatMode.value = pendingPathFormat.value
  showPathFormatConfirm.value = false
}

function cancelPathFormatChange() {
  showPathFormatConfirm.value = false
}
const api = useApi()
const feedback = useFeedback()
const auth = useAuth()

const loading = ref(true)
const saving = ref(false)
const showResetConfirm = ref(false)
const showReinitializeConfirm = ref(false)
const form = ref<AppConfig | null>(null)
const savedConfig = ref<AppConfig | null>(null)
const matchingConfig = computed<InitializationMatchingConfig>({
  get: () => form.value?.initializationMatching ?? structuredClone(DEFAULT_INITIALIZATION_MATCHING),
  set: value => {
    if (form.value) form.value.initializationMatching = value
  },
})
const savedMatchingConfig = computed(() => savedConfig.value?.initializationMatching ?? DEFAULT_INITIALIZATION_MATCHING)
const testing = ref<string | null>(null)
type TestResultTone = 'success' | 'warning' | 'error'
interface TestResultState { tone: TestResultTone; msg: string }
interface ConnectionTestPayload {
  mappedPrefix?: string
  storageVisibility?: StorageVisibilityDiagnosticType
}
const testResult = ref<Record<string, TestResultState | undefined>>({})
const storageDiagnostic = ref<StorageVisibilityDiagnosticType | null>(null)
const changingPassword = ref(false)
const reinitializing = ref(false)
const passwordForm = ref({
  current: '',
  next: '',
  confirm: '',
})
const storageConfigFingerprint = computed(() => JSON.stringify({
  server: form.value?.plex.server ?? '',
  port: form.value?.plex.port ?? 0,
  token: form.value?.plex.token ?? '',
  section: form.value?.plex.section ?? '',
  downloadDir: form.value?.download.dir ?? '',
  plexPathPrefix: form.value?.download.plexLibraryPathPrefix ?? '',
}))

watch(storageConfigFingerprint, (current, previous) => {
  if (!previous || current === previous) return
  storageDiagnostic.value = null
  testResult.value = {
    ...testResult.value,
    plex: undefined,
    download: undefined,
  }
})

// ── Tab navigation ──
const route = useRoute(), router = useRouter()
const activeTab = ref<string>(['general','media','sync','matching','artists','display','advanced'].includes(String(route.query.tab)) ? String(route.query.tab) : 'general')
const categorySearch = ref('')
const configLoadError = ref('')
const artistNamesError = ref('')
const hasChanges = computed(() => !!artistNamesError.value || (!!form.value && JSON.stringify(form.value) !== JSON.stringify(savedConfig.value)))
function applyArtistNames(value: ArtistNameSettings) { if(form.value) { matchingConfig.value = {...matchingConfig.value, artistAliases: value.matching}; form.value.other.artistAliases = value.replacements } }
const visibleSettingsTabs = computed(() => tabs.filter(tab => `${tab.label} ${categoryDescriptions[tab.key]}`.toLocaleLowerCase().includes(categorySearch.value.trim().toLocaleLowerCase())))
watch(activeTab, tab => { void router.replace({query:{...route.query,tab}}) })
watch(() => route.query.tab, tab => { if(tabs.some(item => item.key === tab)) activeTab.value = String(tab) })
function discardConfig(){if(savedConfig.value){form.value=JSON.parse(JSON.stringify(savedConfig.value));applyFontScale(form.value!.other.fontScale)}}

// ── Collapsible sections ──
type SectionKey = 'netease' | 'plex' | 'download' | 'filePolicy' | 'aliases' | 'schedule' | 'sync' | 'mediaPolicy' | 'album' | 'security' | 'retention' | 'other' | 'import' | 'danger'
const collapsed = ref<Partial<Record<SectionKey, boolean>>>({})

function toggle(key: SectionKey) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
}

async function loadConfig() {
  loading.value = true
  configLoadError.value = ''
  try {
    const loaded = await api.get<AppConfig>('/config')
    const normalized = { ...loaded, initializationMatching: loaded.initializationMatching ?? structuredClone(DEFAULT_INITIALIZATION_MATCHING) }
    form.value = normalized
    savedConfig.value = structuredClone(normalized)
    applyFontScale(loaded.other.fontScale)
  } catch (err) {
    form.value = null
    configLoadError.value = err instanceof Error ? err.message : '请检查连接后重试'
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!form.value || saving.value || artistNamesError.value) return
  saving.value = true
  const submitted: AppConfig = JSON.parse(JSON.stringify(form.value))
  try {
    const previous = savedConfig.value
    const updated = await api.put<AppConfig>('/config', submitted)
    if (JSON.stringify(form.value) === JSON.stringify(submitted)) form.value = updated
    savedConfig.value = structuredClone(updated)
    applyFontScale(updated.other.fontScale)

    const pathChanged = !!previous && (
      previous.download.dir !== updated.download.dir ||
      previous.download.plexLibraryPathPrefix !== updated.download.plexLibraryPathPrefix
    )
    showConfigFeedback(
      'success',
      '配置已保存',
      pathChanged
        ? '媒体路径配置已变更，建议对受影响的同步源执行“重新评估自动匹配并同步”。'
        : undefined,
    )
  } catch (err) {
    showConfigFeedback('error', '配置保存失败', err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleReset() {
  showResetConfirm.value = false
  try {
    const defaults = structuredClone(DEFAULT_CONFIG)
    await api.put<AppConfig>('/config', defaults)
    form.value = defaults
    savedConfig.value = structuredClone(defaults)
    applyFontScale(defaults.other.fontScale)
    showConfigFeedback('success', '已恢复默认配置')
  } catch (err) {
    showConfigFeedback('error', '恢复默认失败', err instanceof Error ? err.message : '请稍后重试')
  }
}

async function testConnection(section: 'netease' | 'plex' | 'download') {
  if (!form.value) return
  testing.value = section
  testResult.value = { ...testResult.value, [section]: undefined }
  try {
    const result = await api.post<ConnectionTestPayload>('/config/test-connection', { section, config: form.value })
    if (result.storageVisibility) storageDiagnostic.value = result.storageVisibility
    const warning = result.storageVisibility?.status === 'warning'
    testResult.value = {
      ...testResult.value,
      [section]: {
        tone: warning ? 'warning' : 'success',
        msg: section === 'download'
          ? (warning ? '目录可写，文件发布待确认' : '目录可写，文件发布已验证')
          : section === 'plex' && warning
            ? '连接正常，文件发布待确认'
            : '连接正常',
      },
    }
  } catch (err) {
    testResult.value = { ...testResult.value, [section]: { tone: 'error', msg: err instanceof Error ? err.message : '连接失败' } }
  } finally {
    testing.value = null
  }
}

function testResultClass(result: TestResultState | undefined): string {
  if (result?.tone === 'success') return 'text-success'
  if (result?.tone === 'warning') return 'text-warning'
  return 'text-danger'
}

function testResultIcon(result: TestResultState | undefined): string {
  if (result?.tone === 'success') return 'check'
  if (result?.tone === 'warning') return 'warn'
  return 'x'
}

async function handleChangePassword() {
  if (passwordForm.value.next !== passwordForm.value.confirm) {
    feedback.error('密码修改失败', '两次输入的新密码不一致')
    return
  }
  changingPassword.value = true
  try {
    await auth.changePassword(passwordForm.value.current, passwordForm.value.next)
    passwordForm.value = { current: '', next: '', confirm: '' }
    feedback.success('管理员密码已修改', '请使用新密码重新登录。')
    await navigateTo('/login')
  } catch (err) {
    feedback.error('密码修改失败', err instanceof Error ? err.message : '请稍后重试')
  } finally {
    changingPassword.value = false
  }
}

async function handleReinitialize() {
  showReinitializeConfirm.value = false
  reinitializing.value = true
  try {
    await auth.reinitializeSetup('manual')
    feedback.success('已进入重新初始化', '请重新确认运行所需条件。')
    await navigateTo('/setup')
  } catch (err) {
    feedback.error('重新初始化失败', err instanceof Error ? err.message : '请稍后重试')
  } finally {
    reinitializing.value = false
  }
}

function showConfigFeedback(type: 'success' | 'error', title: string, message?: string) {
  if (type === 'success') feedback.success(title, message)
  else feedback.error(title, message)
}

function applyFontScale(scale: number) {
  if (import.meta.server) return
  appearance.setScale(scale || 1)
}

// ── Import / Export ──
const { showImportTextarea, importJson, importing, importResult, handleFileImport, handleImportJson, handleExport } = useConfigImport(loadConfig)

onMounted(loadConfig)
</script>

<style scoped src="~/assets/css/pages/config.css"></style>
