# 第三方组件与许可证

md2pdf Skill 自身代码采用 MIT License。第三方组件仍归各自权利人所有，并遵循各自许可证。

## 随仓库分发的组件

| 文件 | 上游项目 | 许可证 | 标识 |
|---|---|---|---|
| `mermaid.min.js` | [Mermaid](https://github.com/mermaid-js/mermaid) | MIT | SHA-256 `70137e77bb273bb2ef972b86e8b0400cca8be53cb25bfc45911a186dc98665de` |

该压缩构建没有暴露足以可靠确认发布版本的运行时版本号，因此本项目以文件哈希标识实际分发内容，不对版本号做推测。Mermaid 的许可证副本见 [`licenses/MERMAID-LICENSE.txt`](licenses/MERMAID-LICENSE.txt)。

## npm 直接依赖

以下版本来自 `package-lock.json`。依赖代码不直接提交到本仓库，通过 `npm ci` 安装，并由对应 npm 包携带许可证文件。

| 包 | 锁定版本 | 用途 | 许可证 |
|---|---:|---|---|
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.12.0 | 代码语法高亮和谨慎的语言自动识别 | BSD-3-Clause |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.16.47 | 数学公式排版 | MIT |
| [Marked](https://github.com/markedjs/marked) | 14.1.4 | Markdown 解析 | MIT |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | 25.10.0 | 控制 Chrome / Edge 打印 PDF | Apache-2.0 |

`package-lock.json` 还记录了这些包的传递依赖。重新分发安装后的 `node_modules` 时，应同时保留各包自带的许可证和通知文件。

## Python 可选依赖

这些依赖通过 `requirements.txt` 安装，不直接提交到仓库：

| 包 | 用途 | 许可证 |
|---|---|---|
| [Pillow](https://github.com/python-pillow/Pillow) | 页面缩略图和联系表 | MIT-CMU |
| [pypdf](https://github.com/py-pdf/pypdf) | PDF 读取、链接检查、合并和加密 | BSD-3-Clause |
| [ReportLab](https://github.com/MrBitBucket/reportlab-mirror) | 生成水印页面 | BSD-3-Clause 风格许可证 |

## 浏览器与 Poppler

Chrome、Edge、Chromium 和 Poppler 不由本仓库分发。用户需要按照各自发行渠道和许可证安装或使用。

本文件用于帮助识别依赖关系，不替代各上游项目随软件分发的正式许可证文本。
