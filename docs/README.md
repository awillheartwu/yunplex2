# reYunPlex 文档索引

## 从这里开始

- [项目 README](../README.md)：安装、运行、配置和公开 API 概览。
- [项目路线图](../ROADMAP.md)：当前基线、优先级、里程碑和完成定义。
- [领域词汇](../CONTEXT.md)：Playlist Source、Identity Binding、Source Convergence 等统一语言。

## 当前实现

- [当前架构](architecture.md)：运行拓扑、模块责任、主要调用链、数据责任和系统不变量。
- [同步与身份匹配流程](sync-flow.md)：入口、模式、配置继承、匹配顺序和删除保护。
- [同步比较决策](compare-decision.md)：跳过、完整比较、纯重排与结果分类。

这三份文档描述当前工作树。行为调整时必须和代码、测试一起更新。

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
