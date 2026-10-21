# 界面规范

页面共享同一套颜色、字体和控件。文字说明实际状态，按钮描述实际结果。

## 页面与文案

日常入口是工作台、音乐库、添加音乐和活动；偏好设置、系统状态用于配置和诊断。来源详情集中展示歌曲、首次接管、设置和运行记录。

- 每页一个主标题和一处主要操作。标题、说明、筛选和内容分层，避免重复卡片和多重侧栏。
- 按钮使用短而明确的动词。复杂影响放在相邻说明或 `ActionHint` 中。
- 区分加载中、读取失败、确实为空和筛选无结果。读取失败保留已有内容并提供重试。
- 显示真实阶段和数量。有明确分母才显示百分比；文件下载与 Plex 更新分别显示进度。
- 列表保留跨页选择。切换展示方式、状态或筛选条件时清空选择；批量操作部分失败时保留选择，并区分成功和失败数量。
- 首次接管必须先选择证据分类，才能批量处理筛选结果。存在无明确候选的歌曲时先逐首核对，再批量使用 Plex。具体流程见[首次接管](initialization-matching.md)。
- 设置保存失败时保留输入；旧请求的迟到响应不能覆盖新输入。未保存修改离开页面时由 `UnsavedChangesGuard` 提醒。
- 全局搜索覆盖页面、收藏和设置项。设置项定位与声明方式见下方“设置搜索”。
- 主题和字号可以缓存在浏览器；配置凭据与认证信息不写入本地存储。
- 同步阶段、失败记录和首次接管的业务规则以[同步与下载](sync-flow.md)和[首次接管](initialization-matching.md)为准，界面只呈现并操作这些事实。

## 设置搜索

`modules/settings-search.ts` 在开发启动和生产构建时扫描 `pages/config.vue`、`components/config/` 下的 Vue 模板，生成 `.nuxt/settings-search-index.ts`。开发时修改组件会重新生成目录；生成文件随前端打包，不提交，也不写入数据库。

小节在 `ConfigSection` 上声明静态 `section-key`、`title`、`description` 和 `search-tab`。字段在 `FormField` 或 `ToggleField` 上声明静态 `setting`、`label`，自动归入所在小节；独立子组件中的字段用 `search-section` 指明小节。新增或改名只修改组件，不维护另一份目录。

```vue
<ConfigSection
  section-key="schedule"
  title="同步调度"
  description="控制自动同步的间隔和资源占用"
  search-tab="sync"
  :collapsed="collapsed.schedule"
  @toggle="toggle('schedule')"
>
  <FormField setting="sync.downloadConcurrency" label="下载并发数" search-keywords="同时下载 数量">
    <input v-model.number="form.sync.downloadConcurrency" type="number" />
  </FormField>
</ConfigSection>
```

`search-keywords` 可补充别名。条件隐藏的字段用 `search-fallback` 指向同小节的控制开关，并用 `search-hidden-hint` 说明需要开启或关闭。扫描器只读取声明文字，不读取表单值，也不执行模板表达式。名称、小节或定位标识有误时，开发终端报错并保留上次成功的目录，修正后重新生成；生产构建直接失败。

原生布局通过 `data-setting-target="section:小节标识"`、`data-setting-title`、`data-setting-description`、`data-setting-tab` 声明小节；原生字段使用 `data-setting-target="字段标识"`、`data-setting-label`。搜索别名和隐藏条件使用对应的 `data-setting-keywords`、`data-setting-fallback`、`data-setting-hidden-hint`。定位元素仍绑定 `settingTargetId()`；需要在多个位置复用标题时从 `lib/settings-catalog.ts` 读取生成结果。

## 样式入口与归属

`nuxt.config.ts` 全局加载字体、设计变量、基础排版和共享控件样式：

| 文件                                           | 负责什么                                                 |
| ---------------------------------------------- | -------------------------------------------------------- |
| `assets/css/fonts.css`                         | 本地 Inter 与 JetBrains Mono 的 `@font-face` 声明        |
| `assets/css/tokens.css`                        | 浅色、深色主题以及颜色、字号、间距、圆角、动画和浮层层级 |
| `assets/css/main.css`                          | 根字号、语义排版、焦点、减少动态效果和基础规则           |
| `assets/css/global/controls.css`               | 按钮、表单、复选框和图标按钮                             |
| `assets/css/global/components.css`             | 共享卡片、筛选、提示和移动端布局                         |
| `assets/css/pages/`                            | 对应页面的结构与响应式布局                               |
| `assets/css/components/` 或组件 `style scoped` | 组件内部布局和状态                                       |

页面、布局和组件通过 `<style scoped src="...">` 或内联 `<style>` 引入自己的样式。子组件和 Teleport 浮层不能依赖另一个页面曾加载过样式；同一选择器在同一条件下只定义一次。

新增样式先使用已有控件和语义变量。颜色不写死在组件里；字号、字重和圆角使用设计变量，布局宽度和几何计算可以使用必要的尺寸。`pnpm check:styles` 静态检查硬编码颜色、字号、字重和圆角、未定义变量与循环引用、缺失的样式依赖以及重复选择器。

## 字体与控件

界面使用本地 Inter Variable、JetBrains Mono Regular/Medium 和系统中文字体。字体文件、来源与许可见 [public/fonts/README.md](../public/fonts/README.md)。

字号使用 `rem`，`--font-scale` 同时缩放文字和以 `rem` 定义的控制尺寸。外观设置为 `0.8–1.5` 倍，正文行高为 `1.6`，标题行高为 `1.3`。

| 用途                 | 变量                              | 默认字号   |
| -------------------- | --------------------------------- | ---------- |
| 时间、状态、辅助说明 | `--text-xs`                       | 12px       |
| 紧凑列表、标签       | `--text-sm`                       | 13px       |
| 正文、输入框、按钮   | `--text-base`                     | 14px       |
| 小节标题             | `--text-md`、`--text-lg`          | 16px、18px |
| 页面标题             | `--text-3xl`；手机用 `--text-2xl` | 32px；24px |

- 标题使用统一层级，不在页面单独覆盖字号和字重。
- 普通按钮和单行表单控件桌面最小高度 40px；`btn-sm` 为 36px，`btn-xs` 为 32px。手机控件至少 44px，同组操作保持同高。
- 主要操作使用 `btn-primary`；普通操作使用 `btn-secondary`；查看、返回、取消和刷新使用 `btn-ghost`。辅助确认使用 `btn-soft`；检查使用 `btn-info`，文件替换使用 `btn-warning`，删除使用 `btn-danger`。
- 单值筛选使用 `FilterSegmentGroup`，页面内容切换使用 `PageTabs`，可叠加条件使用 `FilterChip`。筛选条件不要排列成一排普通操作按钮。
- 强调色用于选择、当前导航和主要操作。成功、等待、失败等状态同时使用颜色和文字表达，不能只靠颜色传达含义。
- 键盘焦点始终可见；动画遵守减少动态效果设置。选中色上的文字使用 `--on-accent`。浅色和深色主题的正文与状态文字应保持至少 4.5:1 对比度。

## 列表与浮层

- 长列表分页渲染，跨页选择保留；筛选或排序变化时回到首页。统一使用 `PageNavigator`。
- 浮层使用 `lib/overlay-layers.ts` 对应的 CSS 层级。Esc 关闭最上层，关闭后恢复原焦点。
- 手机正文、保存条和提示预留底栏与安全区，使用 `--mobile-dock-space` 和 `--floating-bottom`。
- 页面返回前台、网络恢复或 SSE 重连时刷新当前数据，同时保留正在编辑的草稿。

## 检查

`pnpm check:styles` 是静态检查，不运行测试或构建。页面测试位于 `tests/browser/`，覆盖真实控件、主题、字号、键盘操作和手机布局；按[测试说明](../tests/README.md)只在用户明确要求“版本收尾”时运行。排查截图只在需要时生成并放到仓库外；自动化通过后，页面的阅读与触控体验仍需实际查看。
