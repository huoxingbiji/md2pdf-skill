# 安装与升级

## 1. 环境要求

| 组件 | 要求 | 用途 |
|---|---|---|
| Node.js | `>=22.12.0` | 主转换器、KaTeX、Mermaid、代码高亮和浏览器打印 |
| npm | 随 Node.js 安装 | 安装锁定的 JavaScript 依赖 |
| Chrome / Edge | 当前受支持版本 | 将渲染后的 HTML 打印为 PDF |
| Python | `>=3.11` | 水印、AES-256 权限保护和 PDF QA |
| Poppler | 可选 | `qa_pdf.py` 渲染页面 PNG 时使用 `pdftoppm` |

Puppeteer 通常会在安装时准备兼容浏览器。如果安装脚本被包管理器阻止，转换器仍会尝试查找系统中的 Chrome 或 Edge。

## 2. 作为普通命令行项目安装

```bash
git clone https://github.com/huoxingbiji/md2pdf-skill.git
cd md2pdf-skill
npm ci
```

需要水印、权限保护或 QA 时继续安装 Python 依赖：

```bash
python -m pip install -r requirements.txt
```

验证安装：

```bash
node convert.mjs --help
npm test
```

## 3. 作为 Codex Skill 安装

### Windows

```powershell
git clone https://github.com/huoxingbiji/md2pdf-skill.git "C:\Users\<用户名>\.codex\skills\md2pdf"
Set-Location "C:\Users\<用户名>\.codex\skills\md2pdf"
npm ci
python -m pip install -r requirements.txt
```

### macOS / Linux

```bash
git clone https://github.com/huoxingbiji/md2pdf-skill.git ~/.codex/skills/md2pdf
cd ~/.codex/skills/md2pdf
npm ci
python3 -m pip install -r requirements.txt
```

安装完成后重新打开 Codex 任务，或在新任务中调用 `$md2pdf`。

## 4. 浏览器定位

转换器依次查找：

1. 环境变量 `MD2PDF_BROWSER`；
2. Windows 常见的 Chrome / Edge 安装路径；
3. macOS 的 Chrome / Edge 应用路径；
4. Linux 常见的 `google-chrome` / `chromium` 路径；
5. Puppeteer 自己安装的浏览器。

自动查找失败时，显式指定浏览器：

PowerShell：

```powershell
$env:MD2PDF_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node .\convert.mjs input.md output.pdf
```

Bash：

```bash
export MD2PDF_BROWSER=/usr/bin/google-chrome
node ./convert.mjs input.md output.pdf
```

## 5. Python 定位

水印或权限后处理会按以下顺序查找 Python：

1. `MD2PDF_PYTHON`；
2. Codex 工作区依赖中的 Python；
3. PATH 中的 `python`。

示例：

```powershell
$env:MD2PDF_PYTHON = 'C:\Python312\python.exe'
```

## 6. Poppler

`qa_pdf.py --render all|sample` 需要 `pdftoppm`。如果系统 PATH 中不存在，脚本会尝试使用 Codex 工作区依赖中的 Poppler。

只检查 PDF 元数据、文本标记和内部链接，不渲染图片时，可以使用：

```bash
python scripts/qa_pdf.py output.pdf --out-dir tmp/qa --render none
```

## 7. 升级

```bash
git pull --ff-only
npm ci
python -m pip install -r requirements.txt --upgrade
npm test
```

如需固定到特定版本：

```bash
git fetch --tags
git checkout v1.2.0
npm ci
```

标签对应不可变发布版本；`main` 包含最新文档和后续修复。

## 8. 卸载

删除克隆目录即可。工具不会创建系统服务，也不会修改全局浏览器设置。
