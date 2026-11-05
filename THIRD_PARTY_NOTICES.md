# 第三方声明

YunPlex 的 MIT 许可和 `YunPlex contributors` 署名仅适用于项目自有代码。第三方软件、字体和其他素材保留各自的版权、署名与许可，不因随 YunPlex 分发而改用 MIT。

## npm 依赖

生产构建会原样收集已安装依赖包随附的 LICENSE、LICENCE、COPYING 和 NOTICE 文件，保留包名与版本。缺少独立文件时，使用 `licenses/upstream/` 中按锁定版本核对的上游原文，包括 README 中的完整授权段。清单及原文位于生产包的 `licenses/npm/`，镜像内对应 `/app/.output/licenses/npm/`。清单同时列出尚缺原文的项目及其服务端运行依赖归属；镜像验收要求服务端运行依赖的原文缺失数为零。

该目录可能同时包含构建工具的许可，以保留前后端打包过程中使用的依赖声明。它不改变各组件的许可，也不代表所有列出的包都会在运行时加载。依赖版本以锁文件和构建清单为准。

## 字体

- Inter：保留 The Inter Project Authors 的署名及 SIL Open Font License 1.1，原文见 `public/fonts/Inter-OFL.txt`。
- JetBrains Mono：保留 The JetBrains Mono Project Authors 的署名及 SIL Open Font License 1.1，原文见 `public/fonts/JetBrainsMono-OFL.txt`。

字体原文随静态文件一并分发，镜像内位于 `/app/.output/public/fonts/`。

## 镜像与原生组件

镜像包含 `/app/LICENSE`、本声明及上述依赖和字体许可。Node.js、Alpine Linux、原生库和基础镜像中的组件保留其各自的许可；YunPlex 的 MIT 标签不覆盖这些组件。原生 FLAC 绑定对应的 libFLAC 与 libogg 原文也随 npm 许可目录提供。
