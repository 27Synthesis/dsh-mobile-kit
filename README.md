# 鲸鲸工具箱 · dsh-mobile-kit

给 **DSH Go 手机端**用的原生插件。把手机上"必须装个 App 才能干"的活，变成一句话。

> 在 Android 上的 DSH 引擎里直接跑 Python + Node，不联云、不上传文件——图片、压缩包、表格、网页、数据库全在本机处理。

## 它解决什么

手机相册里一张 16 MB 的照片发不出去、群里下发的 zip 打不开、Excel 想转 CSV 却没装 Office、网页文章想离线保存、游戏存档的 `.db` 想看看里面有什么……
这些事以前只能靠安装一堆 App，现在由 Agent 直接调用工具完成。

## 六个工具

| 工具 | 能力 | 典型用法 |
|---|---|---|
| `img_ops` | 看尺寸/格式/EXIF，缩放、压缩、转格式、旋转、裁剪 | 「这张照片压到 1 MB 以内」 |
| `archive_ops` | zip / tar.gz 列目录、解压、打包 | 「解压这个资料包到 Download」 |
| `web_save` | 抓网页存原文件；`mode=text` 得到去标签正文 | 「把这篇文章存下来离线看」 |
| `sheet_ops` | CSV / xlsx 看行列数、读前 N 行、CSV↔xlsx 互转 | 「这个 Excel 有多少行」 |
| `sqlite_query` | 只读打开任意 SQLite 库：列表、建表语句、SELECT | 「存档里改了哪些字段」 |
| `kit_health` | 后端自检：Python / Pillow / openpyxl / SQLite 版本与使用次数 | 「工具箱还好吗」 |

同时提供一个原生面板（对话详情页「插件」页签），显示后端状态与各工具调用次数。

## 设计要点

- **后端用 Python，前端用 Node。** 图片靠 Pillow，表格靠 openpyxl，压缩包靠标准库 `zipfile`/`tarfile`——不依赖系统 `unzip`、`ffmpeg`、ImageMagick，装上就能用。
- **不碰网络。** 除 `web_save` 按需抓取指定 URL 外，所有操作都是本地文件处理。
- **不写脏数据。** 产出默认落在 `手机存储/Download/DSH-Go/`，`sqlite_query` 以只读模式打开数据库，任何 `insert/update/delete` 一律拒绝。
- **zip 路径穿越防护。** 解压前逐条校验目标路径必须落在目标目录内。
- **大文件有上限。** 网页抓取 20 MB 封顶，SQL 默认返回 100 行。

## 安装

```bash
# 1. 放进 dsh-go 插件目录
git clone https://github.com/<you>/dsh-mobile-kit.git \
  "$DSH_HOME/dsh-go/plugins/local-mobile-kit"

# 2. 装进 profile（装成链接，改代码不用重装）
dsh plugin --profile web add "$DSH_HOME/dsh-go/plugins/local-mobile-kit"

# 3. 在 App「引擎」页重启一次
```

依赖：Python 3.10+、Pillow、openpyxl。

```bash
pip install pillow openpyxl
```

## 插件开发者的两个坑

1. **`execute` 必须返回对象**，返回字符串会报 `"value" must be an object`。本插件统一用 `{ text }` 包装。
2. **插件内 `import` 不到 `@deepseek-ai/dsh-tools`**（`$DSH_HOME/dsh-go/plugins` 向上解析不到该包），直接把裸对象传给 `ctx.tools.register({ name, description, parameters, output, execute })`。

## 目录

```
bin/kit.py          Python 后端：stdin 一个 JSON 请求，stdout 一个 JSON 回复
lib/index.js        Node 前端：注册 6 个工具 + 原生面板
cordis.patch.yml    插件补丁入口
package.json        清单（含 dshGo 原生界面声明）
```

## License

MIT
