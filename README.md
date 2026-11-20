# bookz / Moka 考勤工时

本机工程目录建议：

```text
/Users/bookz/Desktop/bookz
```

插件源码在仓库内：`moka-attendance-extension/`  
打包文件：`dist/moka-attendance-extension.zip`、`dist/bookz-moka-attendance.zip`

## 放到本机 Desktop

在 Mac 终端执行：

```bash
mkdir -p /Users/bookz/Desktop/bookz
cd /Users/bookz/Desktop/bookz
git clone -b cursor/moka-attendance-hours-extension-0d0d https://github.com/zh-book/book.git .
```

或下载解压 `bookz-moka-attendance.zip`，把内容放进 `/Users/bookz/Desktop/bookz`。

Chrome 加载扩展时选择：

```text
/Users/bookz/Desktop/bookz/moka-attendance-extension
```

## 与旧插件共用数据

- **同一扩展点「重新加载」**：数据自动保留
- **已经变成两个扩展**：旧弹窗点「导出」→ 新弹窗点「导入」合并

详细说明见 [`moka-attendance-extension/README.md`](./moka-attendance-extension/README.md)。
