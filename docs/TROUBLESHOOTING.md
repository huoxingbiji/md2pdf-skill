# 常见问题与排错

## 未找到 Chrome 或 Edge

错误信息：`未找到 Chrome/Edge`。

处理方式：

1. 确认已经执行 `npm ci`；
2. 安装 Chrome 或 Edge；
3. 使用 `MD2PDF_BROWSER` 指向浏览器可执行文件；
4. 再次运行 `node convert.mjs --help` 和转换命令。

## Puppeteer 安装脚本被阻止

部分包管理器会阻止 Puppeteer 下载浏览器。如果系统已有 Chrome/Edge，转换器通常仍可运行；否则允许 Puppeteer 的安装脚本，或手动设置 `MD2PDF_BROWSER`。

## 代码围栏未闭合

错误信息会指出起始行。检查开头和结尾是否使用相同字符，并且结尾围栏长度不短于开头：

````markdown
```python
print("ok")
```
````

## 公式解析失败

- 检查 `$$` 是否成对；
- 检查命令是否为 KaTeX 支持的写法；
- 确认公式没有被拆到代码围栏外；
- 不要忽略错误后交付原始 LaTeX。

## Mermaid 渲染失败

- 将图复制到 Mermaid 编辑器中检查语法；
- 检查节点文字中的括号、引号和特殊符号；
- 确认 `classDef`、`class` 和节点 ID 一致；
- 复杂图先简化，再决定是否使用 `full-page`。

## Mermaid 太小

对单图使用：

````markdown
```mermaid full-page
...
```
````

或全局使用 `--diagram full-page`。宽图会自动切换为 A4 横向页面。

## 图片加载失败

图片必须是 Markdown 目录内或子目录中的相对路径。检查大小写、空格、中文文件名和扩展名是否一致。

远程 HTTP/HTTPS 图片会被请求拦截。先将有权使用的图片保存到文档目录，再以相对路径引用。

## 目标文件被占用

Windows 阅读器可能锁定正在打开的 PDF。转换器会回退到 `_new.pdf`。关闭阅读器后重新生成，确保最终只保留稳定文件名。

## 目录看得见但不能点击

1. 使用 `--toc on` 重新生成；
2. 运行：

   ```bash
   python scripts/qa_pdf.py output.pdf --out-dir tmp/qa --render none --expect-internal-links
   ```

3. 检查 PDF 阅读器是否允许内部跳转；
4. 如果使用了额外 PDF 后处理工具，确认它没有删除链接注释或命名目标。

## 代码语言识别错误

自动识别只用于未声明语言的代码块。最可靠的解决方式是在围栏后明确写出语言，例如 `javascript`、`python` 或 `sql`。

完全不需要着色时使用 `--highlight off`。

## QA 报告出现原始 Markdown 标记

`double_asterisk`、`double_dollar` 或反斜杠命中可能来自合法代码示例。打开对应页面，并与源 Markdown 对照：

- 正文中显示原始标记：需要修复；
- 深色代码块中按原样展示：通常是预期结果。

## 水印或加密找不到 Python

```bash
python -m pip install -r requirements.txt
```

如有多个 Python，使用 `MD2PDF_PYTHON` 指定安装了 `pypdf` 和 `reportlab` 的解释器。

## QA 无法找到 pdftoppm

安装 Poppler 并把 `pdftoppm` 加入 PATH；或者使用 `--render none` 只做结构、文本和链接检查。

## 仍然无法解决

提交 Issue 时请附上：

- 操作系统、Node.js 和 Python 版本；
- 完整命令，但删除密码和敏感路径；
- 转换器完整错误日志；
- 最小化且已脱敏的 Markdown；
- 如果 PDF 已生成，附上 QA JSON 报告和问题页截图。
