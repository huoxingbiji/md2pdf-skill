# 贡献指南

感谢你愿意改进 md2pdf Skill。欢迎提交错误报告、使用场景、文档改进和代码贡献。

## 提交问题前

1. 搜索现有 Issues，避免重复；
2. 使用最新 `main` 或最近发布标签复现；
3. 删除 Markdown、路径、日志和 PDF 中的敏感信息；
4. 尽量提供可以公开的最小复现文档。

安全漏洞不要作为普通 Issue 公开，请遵循 [SECURITY.md](SECURITY.md)。

## 开发环境

```bash
git clone https://github.com/huoxingbiji/md2pdf-skill.git
cd md2pdf-skill
npm ci
python -m pip install -r requirements.txt
npm test
```

Node.js 需要 `>=22.12.0`。水印、权限保护和 QA 需要 Python 3.11+。

## 修改原则

- 保持源 Markdown 不变；预处理和安全修复只作用于内存或临时副本；
- 公式或 Mermaid 解析失败时应阻止交付，不能静默降级为原始文本；
- 目录链接、代码高亮和页面布局的改动必须有可观察的回归测试；
- 不要对所有块统一设置 `break-inside: avoid`，这会制造异常空白；
- 密码只通过环境变量传递；
- 不要放宽本地文件读取边界或浏览器请求拦截，除非同时提交安全分析和测试。

## 测试

基础冒烟测试：

```bash
npm test
```

综合回归：

```bash
node convert.mjs tests/fixtures/regression.md tmp/regression.pdf --toc on --highlight auto --diagram auto
python scripts/qa_pdf.py tmp/regression.pdf --out-dir tmp/qa --render all --expect-internal-links
```

必须人工检查联系表，并高清查看目录、代码、公式、Mermaid、长表格和末页。

负向测试应确认失败时没有留下正式 PDF，例如未闭合围栏、无效公式和缺失链接目标。

## 测试样例

- 新功能应在 `tests/fixtures/` 增加最小样例；
- 不提交真实公司文档、个人数据、密码或客户信息；
- 图片优先使用小型 SVG；
- 测试必须在 Windows 和 Linux 路径规则下都可运行。

## 第三方构建

`mermaid.min.js` 是按二进制方式跟踪的离线浏览器构建。更新它时必须同时：

1. 记录可靠的上游版本或来源；
2. 更新 `THIRD_PARTY_NOTICES.md` 中的 SHA-256；
3. 核对上游许可证并保留许可证副本；
4. 运行包含 Mermaid 的综合回归。

不要只为了格式检查而改写压缩文件。

## Pull Request

PR 应说明：

- 要解决的问题；
- 行为变化和兼容性影响；
- 已执行的测试；
- 涉及页面布局时的前后截图或脱敏 PDF；
- 是否更新用户文档、CLI 帮助和 `SKILL.md`。

保持每个 PR 聚焦一个主题。提交信息推荐使用 `feat:`、`fix:`、`docs:`、`test:` 或 `chore:` 前缀。

## 版本

项目使用语义化版本：

- 补丁版本：兼容修复和文档修正；
- 次版本：向后兼容的新能力；
- 主版本：需要用户调整用法的破坏性变化。
