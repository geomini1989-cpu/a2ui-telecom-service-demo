# 配置与运行

[返回项目首页](../README.md)


### 1. 获取项目

需要 **Node.js 24.13 或更新的 24.x 版本**，项目使用内置 `node:sqlite`。

```bash
git clone --branch fix/review-package-selection https://github.com/geomini1989-cpu/a2ui-telecom-service-demo.git
cd a2ui-telecom-service-demo
npm ci
npm run dev
```

> 当前功能位于 `fix/review-package-selection` 分支；默认 `main` 与该分支内容不同。

打开 [http://localhost:5173](http://localhost:5173)。开发命令会同时启动 React / Vite 前端和位于 `http://localhost:8787` 的 Express 服务。

不配置模型即可开始演示，此时调试面板显示 `deterministic_fallback`，自然语言理解由本地规则完成。

### 2. 可选：接入 DeepSeek 或兼容模型服务

将根目录的 [.env.example](../.env.example) 复制为 `.env`，填写：

```dotenv
LLM_MODE=openai-compatible
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=替换为模型服务密钥
LLM_MODEL=替换为该服务支持工具调用的模型名称
PORT=8787
```

重启开发服务。模型正常执行工具调用时，Debug Inspector 的 `Agent Mode` 显示为 `llm_tool_calling`；未配置或调用失败时会进入规则兜底。模型名称、密钥与服务地址需匹配。

## 启动与持久化配置

- **Node 版本**：请用 `node --version` 检查是否满足 `>=24.13.0 <25`。
- **数据目录**：默认写入 `.data`，可用 `TELECOM_DATA_DIR` 修改；保留目录即可在服务重启后恢复会话。
- **新会话**：页面“新会话”按钮创建独立会话及账户状态，旧会话仍保留。
- **自定义端口**：后端通过 `PORT` 设置；前端开发代理默认指向 `http://localhost:8787`，更改后端端口时需为 Vite 进程设置对应的 `TELECOM_API_URL`。



