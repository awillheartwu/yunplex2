# 上游许可补充

这里只保存锁定依赖的 npm 包中缺失、但能从对应上游源码取得的许可原文。原版权署名和条款保持不变；`sources.json` 记录适用包、版本、上游不可变提交地址及原文 SHA256，构建时校验后随产物提供。

- `flac-bindings@5.0.0`：npm 官方元数据的 `gitHead` 为 `dbf4e8014008fe5b2c546e9a79cff26daeafc43f`，ISC 原文取自该提交的根目录 LICENSE。同版本的 `@melchor629/flac-bindings-lib-*` 平台绑定属于同一发布源码，沿用该项目的 ISC 原文。原生源码清单和构建配置明确使用 libFLAC 1.5.0、libogg 1.3.6，其对应版本的 COPYING.Xiph 和 COPYING 也随平台绑定保留。
- `saxes@6.0.0`：npm 官方元数据的 `gitHead` 为 `211fa0ebec9b628affc09219199639887174bfc3`，原文取自该提交的 LICENSE，包含其保留的历史组件声明。

升级这些依赖时重新核对适用版本、原始源码和署名。没有找到对应原文的包继续出现在构建清单的缺失项中，不用通用文本或兄弟包的许可代替。
