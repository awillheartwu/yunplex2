# reYunPlex 文档索引

## 从这里开始

- [项目 README](../README.md)：安装、运行、配置和公开 API 概览。
- [项目路线图](../ROADMAP.md)：当前基线、优先级、里程碑和完成定义。
- [领域词汇](../CONTEXT.md)：Playlist Source、Identity Binding、Source Convergence 等统一语言。

## 当前实现

- [当前架构](architecture.md)：运行拓扑、模块责任、主要调用链、数据责任和系统不变量。
- [同步与身份匹配流程](sync-flow.md)：入口、模式、配置继承、匹配顺序和删除保护。
- [初始化匹配](initialization-matching.md)：候选规则、独立别名字典、同快照试算与草案参数。
- [同步比较决策](compare-decision.md)：跳过、完整比较、纯重排与结果分类。
- [统一错误分类](error-classification.md)：错误码、重试策略和诊断投影。
- [界面设计系统](design-system.md)：视觉令牌、组件、响应式和无障碍规则。
- [音乐工作台改版计划](ui-redesign-plan.md)：本轮范围、参考与验收清单。

## 运行与验收

- [首版运行维护](release-operations.md)：安装、可信反代、停机备份恢复与发布门槛。

- [自动同步诊断](auto-sync-runbook.md)：受控验收、只读数据库诊断和真实同步检查。
- [CI 门禁](ci-runbook.md)：本地复现、浏览器测试和 Forgejo 平台配置。
- [真实环境验收手册](external-acceptance.md)：Plex scraper、路径复用、人工接管、重启和 Forgejo 平台验收。

## 外部验收证据

- [2026-09-09 入口衔接与恢复真实验收](external-acceptance-results-2026-09-09.md)：当前混合批次、接管重启、共享下载、Repair 与单曲重试证据。
- [2026-08-29 真实环境验收结果](external-acceptance-results-2026-08-29.md)：真实 Plex、网易云、NAS、Repair、调度和 Docker 证据。
- [2026-08-31 下载链路与首次媒体接管真实验收](download-convergence-live-acceptance-2026-08-31.md)：全局并发、重启恢复、重试、Repair、两阶段接管和 Source Convergence 的真实运行证据。

带日期的报告保留当时版本及测试对象的证据，不证明后续版本已经通过真实验收。当前行为以架构、同步流程与路线图为准；待验收项统一维护在验收手册和路线图中。

## 架构决策

- [ADR 0001：Playlist Reconciliation](adr/0001-playlist-reconciliation.md) — 已被 ADR 0004 取代，保留作历史背景。
- [ADR 0002：Task Run Visual Semantics](adr/0002-task-run-visual-semantics.md) — 当前有效。
- [ADR 0003：Managed Media Path Identity](adr/0003-managed-media-path-identity.md) — 当前有效，媒体归属与连续性原则继续使用。
- [ADR 0004：Durable Identity Convergence](adr/0004-durable-identity-convergence.md) — 已被 ADR 0005 取代，保留作身份收敛历史。
- [ADR 0005：Safe Media Reuse](adr/0005-safe-media-reuse.md) — 当前有效，取代 ADR 0004 的身份证据顺序。

ADR 记录“为什么作出决定”，不承担当前调用链说明。被替代的 ADR 不删除，只更新状态和替代链接。

## 文档维护规则

- 根目录只保留入口文档、路线图、领域上下文和 agent 指南。
- 一次性截图验收、临时调查结果和本机绝对路径不作为长期文档提交。
- 当前事实进入流程文档；不可逆或影响系统不变量的选择进入 ADR；未完成工作进入 roadmap。
- 文档中的“已验证”必须注明是单元测试、集成测试、构建还是外部 E2E。
