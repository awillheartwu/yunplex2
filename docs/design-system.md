# 界面规范

页面使用一致的颜色、字体和控件。文字说明实际状态，操作说明实际结果。

## 页面与文案

日常入口是工作台、音乐库、添加音乐和活动；偏好设置、系统状态用于配置和诊断。来源详情集中展示歌曲、首次接管、设置和运行记录。

- 每页一个主标题，一处主要操作。标题、说明、筛选和内容分层，避免重复卡片和多重侧栏。
- 按钮用短而明确的动词，复杂影响放在相邻说明或 `ActionHint` 中。
- 区分加载中、读取失败、确实为空和筛选无结果；失败保留已有内容并提供重试。
- 显示真实阶段和数量。有明确分母才显示百分比；文件下载完成与 Plex 更新完成分别显示。
- 添加音乐保留一个下载主操作，收藏作为可选项说明完整来源与自动同步的影响；长列表的提交区保持可见。
- 活动的同步步骤只标记实际经过的阶段，未执行的阶段单独显示跳过。文件进度按本次已处理任务计算，完成与失败的数量分别显示。
- 异常按当前筛选范围汇总相同类别与原因，区分问题数量和歌曲数量；整组操作覆盖全部匹配结果。运行详情可限定本次运行进入异常处理。
- 异常歌曲列表区分本页全选与全部筛选结果全选，选择跨页保留；全选后可排除个别歌曲。切换展示方式、状态或筛选条件时清空选择，批量操作失败保留选择。
- 首次媒体接管必须先选证据分类，才能跨页全选当前筛选结果；允许排除个别歌曲，改变筛选后清空选择。包含无明确候选的项时不能批量使用 Plex，先逐首核对候选。
- 新建收藏只全选当前已加载、符合筛选且未添加的歌单或专辑，不自动加载其他项；加载更多后，新出现的项保持未选。
- 设置保存失败保留输入，保存中的旧响应不能覆盖新输入。未保存修改离开前由 `UnsavedChangesGuard` 提醒。
- 全局搜索支持页面、收藏与设置项。设置目录从组件声明自动生成，选中后展开并定位；条件隐藏的选项提示其控制开关，保留当前配置值。声明方式见下方“设置搜索”。
- 主题和字号可以缓存到浏览器；配置凭据与认证信息不写入本地存储。

## 设置搜索

`modules/settings-search.ts` 在开发启动和生产构建时扫描 `pages/config.vue`、`components/config/` 下的 Vue 模板，生成 `.nuxt/settings-search-index.ts`；开发时新增、修改或删除组件会更新目录。生成文件随前端打包，不提交，也不写入数据库。

小节在 `ConfigSection` 上声明静态 `section-key`、`title`、`description` 和 `search-tab`。字段在 `FormField` 或 `ToggleField` 上声明静态 `setting`、`label`，自动归入所在小节；独立子组件中的字段用 `search-section` 指明小节。新增或改名只修改组件，不维护另一份目录。

```vue
<ConfigSection section-key="schedule" title="同步调度" description="控制自动同步的间隔和资源占用" search-tab="sync" :collapsed="collapsed.schedule" @toggle="toggle('schedule')">
  <FormField setting="sync.downloadConcurrency" label="下载并发数" search-keywords="同时下载 数量">
    <input v-model.number="form.sync.downloadConcurrency" type="number" />
  </FormField>
</ConfigSection>
```

`search-keywords` 可补充别名。条件隐藏的字段用 `search-fallback` 指向同小节的控制开关，并用 `search-hidden-hint` 说明需要开启或关闭。扫描器只读取声明文字，不读取表单值，也不执行模板表达式。名称、小节、定位标识等声明有误时，开发终端会报错并保留上次成功的目录，修正后重新生成；生产构建直接失败。

原生布局通过 `data-setting-target="section:小节标识"`、`data-setting-title`、`data-setting-description`、`data-setting-tab` 声明小节；原生字段使用 `data-setting-target="字段标识"`、`data-setting-label`。搜索别名和隐藏条件使用对应的 `data-setting-keywords`、`data-setting-fallback`、`data-setting-hidden-hint`，定位元素仍绑定 `settingTargetId()`。需要在多个位置复用标题时从 `lib/settings-catalog.ts` 读取生成结果。

## 样式放在哪里

| 文件                                           | 负责什么                                     |
| ---------------------------------------------- | -------------------------------------------- |
| `assets/css/tokens.css`                        | 颜色、字号、间距、圆角、动画和层级的统一取值 |
| `assets/css/main.css`                          | 排版、页面尺寸、焦点和基础工具类             |
| `assets/css/global/controls.css`               | 按钮、表单、复选框和图标按钮                 |
| `assets/css/global/components.css`             | 共享卡片、筛选、提示和移动端布局             |
| `assets/css/pages/`                            | 对应页面的结构与响应式布局                   |
| `assets/css/components/` 或组件 `style scoped` | 组件内部布局和状态                           |

组件显式引入自己的样式。子组件和 Teleport 浮层不能依赖另一个页面曾加载过样式；同一选择器在同一条件下只定义一次。

新增样式先使用已有控件和变量。颜色不写死在组件里，布局宽度和图表几何可以使用必要的计算尺寸。

## 字体与控件

界面使用本地 Inter、JetBrains Mono 和系统中文字体，许可见 [public/fonts/README.md](../public/fonts/README.md)。字号使用 `rem`，外观设置通过 `--font-scale` 一起缩放文字和控件。

| 用途                 | 变量                              | 默认字号   |
| -------------------- | --------------------------------- | ---------- |
| 时间、状态、辅助说明 | `--text-xs`                       | 12px       |
| 紧凑列表、标签       | `--text-sm`                       | 13px       |
| 正文、输入框、按钮   | `--text-base`                     | 14px       |
| 小节标题             | `--text-md`、`--text-lg`          | 16px、18px |
| 页面标题             | `--text-3xl`；手机用 `--text-2xl` | 32px；24px |

- 标题按 H1–H6 使用统一层级，不在页面单独覆盖字号和字重；正文行高 1.6。
- 普通按钮和单行表单控件桌面最小高度 40px；紧凑按钮 `btn-sm` 为 36px，列表内 `btn-xs` 为 32px。手机点击区域至少 44px，同组操作保持同高，字号和尺寸随外观设置缩放。
- 主要操作使用实心 `btn-primary`；普通操作使用中性浅底 `btn-secondary`；查看、返回、取消、刷新使用透明 `btn-ghost`。辅助确认用淡强调色 `btn-soft`；维护区的检查、文件替换分别使用 `btn-info`、`btn-warning`，删除使用 `btn-danger`。
- 按钮不使用常驻描边，悬停提供底色反馈，键盘焦点保持可见。颜色配合动作文字与图标，不能单独表达含义。图标按钮是内容形式，不是独立的操作层级。
- 单选筛选使用 `FilterSegmentGroup`，页面内容切换使用 `PageTabs`，可叠加条件使用 `FilterChip`。不要把筛选条件排列成一排普通操作按钮。
- 强调色用于选择、当前导航和主要操作；成功、等待、失败各用对应状态色，状态文字同时说明含义。
- 键盘焦点始终可见，动画遵守减少动态效果设置。选中色上的文字使用 `--on-accent`。

## 列表与浮层

- 长列表分页渲染，跨页选择保留；筛选或排序变化时回到首页。统一使用 `PageNavigator`。
- 浮层使用 `lib/overlay-layers.ts` 对应的 CSS 层级；Esc 关闭最上层，关闭后恢复原焦点。
- 手机正文、保存条和提示预留底栏与安全区，使用 `--mobile-dock-space`、`--floating-bottom`。
- 页面返回前台、网络恢复或 SSE 重连时刷新当前数据；不要覆盖正在编辑的草稿。

## 检查

`pnpm check:styles` 检查设计变量、样式引用与重复规则。浏览器测试放在 `tests/browser/`，检查真实控件、主题、字号、键盘操作和手机布局，运行方法见[测试说明](../tests/README.md)。

截图只在需要时生成并放到仓库外。自动测试通过后，页面的阅读与触控体验仍需要实际查看。
