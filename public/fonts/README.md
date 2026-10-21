# 内置字体

YunPlex 通过 `/fonts/` 提供以下本地 WOFF2 文件，由 [assets/css/fonts.css](../../assets/css/fonts.css) 声明，运行时无需访问字体 CDN。

| 文件                          | 字体与字重              | 上游版本与许可                                                                                                    |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `InterVariable.woff2`         | Inter Variable，100–900 | [4.1](https://github.com/rsms/inter/tree/v4.1/docs/font-files)、[OFL 许可](Inter-OFL.txt)                         |
| `JetBrainsMono-Regular.woff2` | JetBrains Mono，400     | [2.304](https://github.com/JetBrains/JetBrainsMono/tree/v2.304/fonts/webfonts)、[OFL 许可](JetBrainsMono-OFL.txt) |
| `JetBrainsMono-Medium.woff2`  | JetBrains Mono，500     | [2.304](https://github.com/JetBrains/JetBrainsMono/tree/v2.304/fonts/webfonts)、[OFL 许可](JetBrainsMono-OFL.txt) |

两套字体的 SIL Open Font License 1.1 原文随文件保留，分发时一并提供。替换字体时同步更新来源、版本和对应许可。

中文使用 [assets/css/tokens.css](../../assets/css/tokens.css) 中声明的系统字体回退。
