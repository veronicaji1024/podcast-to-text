# Podcast AI 🎧 播客智能转录

基于 Faster-Whisper 和 GPT-4 的智能播客转录与笔记提取工具。

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 功能特性 ✨

- 🔗 **多平台支持**: Apple Podcasts、小宇宙、RSS 订阅、直接音频链接
- 🚀 **高性能**: 本地 Faster-Whisper 模型，快速准确的语音转文字
- 🤖 **AI 驱动**: GPT-4 优化转录文本并提取结构化笔记
- 🌍 **智能翻译**: 当总结语言与检测语言不同时自动翻译
- 📱 **响应式设计**: 现代化移动端优先界面
- 📄 **导出选项**: 支持 Markdown 和纯文本格式下载

## 快速开始 🚀

### 环境要求

- Node.js 18+
- Python 3.8+
- OpenAI API Key

### 安装

```bash
# 进入项目目录
cd podcast-to-text

# 运行快速安装脚本
./quick-start.sh
```

或手动安装：

```bash
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖
pip3 install faster-whisper

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加你的 OpenAI API Key

# 启动服务
npm start
```

打开 http://localhost:3000 即可使用。

## 配置说明 ⚙️

编辑 `.env` 文件：

```env
# 必填
OPENAI_API_KEY=你的_api_key

# 可选
PORT=3000
WHISPER_MODEL=base  # tiny, base, small, medium, large-v1, large-v2, large-v3
WHISPER_DEVICE=cpu  # cpu 或 cuda
NODE_ENV=production
```

### Whisper 模型选择

| 模型   | 速度  | 准确度   | 显存需求 |
|--------|-------|----------|----------|
| tiny   | ⚡⚡⚡  | ⭐⭐     | ~1 GB    |
| base   | ⚡⚡   | ⭐⭐⭐   | ~1 GB    |
| small  | ⚡    | ⭐⭐⭐⭐ | ~2 GB    |
| medium | 🐢    | ⭐⭐⭐⭐⭐| ~5 GB    |
| large  | 🐢🐢  | ⭐⭐⭐⭐⭐| ~10 GB   |

## 使用方法 📖

1. **粘贴播客链接**（支持 Apple Podcasts、小宇宙、RSS、音频直链）
2. **选择选项**（总结语言、详细程度）
3. **点击"分析链接"**，等待处理完成
4. **查看结果**：在笔记摘要和完整转录之间切换
5. **下载**：保存为 Markdown 或纯文本格式

### 支持的平台

- **Apple Podcasts**: `https://podcasts.apple.com/...`
- **小宇宙**: `https://www.xiaoyuzhoufm.com/episode/...`
- **RSS 订阅**: `https://example.com/feed.xml`
- **音频直链**: `https://example.com/podcast.mp3`

## API 接口 🔌

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/process` | POST | 处理播客链接 |
| `/api/upload` | POST | 上传音频文件 |
| `/api/status/:jobId` | GET | 查询任务状态 |
| `/api/download/:jobId/:type` | GET | 下载结果 |
| `/api/health` | GET | 健康检查 |

### API 使用示例

```bash
# 处理播客链接
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.xiaoyuzhoufm.com/episode/xxx", "language": "zh"}'

# 查询状态
curl http://localhost:3000/api/status/你的任务ID
```

## 项目结构 📁

```
podcast-to-text/
├── public/                 # 前端文件
│   ├── index.html         # 主界面
│   └── script.js          # 客户端逻辑
├── server/                # 后端
│   ├── index.js           # Express 服务器
│   ├── whisper_transcribe.py  # 转录脚本
│   └── services/          # 业务逻辑
│       ├── podcastService.js
│       ├── openaiService.js
│       ├── audioInfoService.js
│       └── rssParser.js
├── .env                   # 环境配置
├── package.json
└── README.md
```

## 处理流程 🔄

1. **链接分析**: 解析 URL 提取播客元数据
2. **音频下载**: 从源地址下载音频文件
3. **语音转录**: 使用 Faster-Whisper 转换为文字
4. **文本优化**: AI 增强转录文本的连贯性
5. **笔记提取**: 使用 GPT-4 生成结构化笔记

## 常见问题 🔧

### 常见问题解决

**Whisper 模型下载失败**
```bash
# 模型会在首次使用时自动下载
# 如果网络受限，可手动从以下地址下载：
# https://huggingface.co/Systran/faster-whisper-
```

**CUDA 显存不足**
```env
# 使用 CPU 或更小的模型
WHISPER_DEVICE=cpu
WHISPER_MODEL=base
```

**OpenAI API 错误**
```bash
# 检查 .env 文件中的 API Key
# 确认网络连接正常
# 查看 OpenAI 服务状态
```

### 日志查看

```bash
# 查看详细日志
DEBUG=* npm start

# 或保存到文件
npm start 2>&1 | tee server.log
```

## 性能优化 ⚡

1. **使用较小的模型** 提高处理速度
2. **启用 GPU** 加速（如有）: `WHISPER_DEVICE=cuda`
3. **先测试短播客** 确保配置正确
4. **监控磁盘空间** - 临时文件可能较大

## 开发模式 💻

```bash
# 开发模式（自动重载）
npm run dev

# 安装开发依赖
npm install --save-dev nodemon
```

## 许可证 📄

MIT 许可证 - 详见 LICENSE 文件。

## 致谢 🙏

- [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) - 快速语音识别
- [OpenAI](https://openai.com/) - GPT-4 文本优化
- [Tailwind CSS](https://tailwindcss.com/) - UI 样式

## 支持 💬

如有问题或功能建议，请使用 GitHub Issues。

---

用 ❤️ 为播客爱好者打造
