# Architecture

## 职责边界

| 层 | 负责 | 不负责 |
|---|---|---|
| LLM | Intent、参数提取 | UI 样式、组件结构 |
| Task Router | Skill、Task State、Card Policy | 视觉实现 |
| Skill | 业务数据/业务动作 | UI |
| A2UI Builder | Surface、Component、DataModel、Action | CSS/React DOM |
| React Catalog | 固定业务卡片与交互体验 | 自然语言理解 |

## Task State 示例

```text
traffic_purchase
  ├─ select_package → TrafficPackageCard
  ├─ confirm_order  → OrderConfirmCard
  └─ completed      → ResultCard
```

这让 UI 选择基于 `Task + State`，而不只是 `Intent -> Card` 一次映射。
