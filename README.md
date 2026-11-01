# p5-campus-mcp · 校园公告板 MCP Server

让任何支持 MCP 的 agent（ZCode / Claude Code / 其他）直接**查、搜、发、删**校园公告。
数据源：[校园公告板](https://whmessi-25.github.io/p2-mytool/)（「Agent 从 0 到精通」P2 产物）。

## 工具清单

| 工具 | 功能 | 谁能用 |
|---|---|---|
| `get_announcements` | 查全部公告（按日期新→旧） | 所有人（读线上实时数据） |
| `search_announcements` | 按关键词搜标题/正文 | 所有人 |
| `publish_announcement` | 发公告（自动 git 提交推送 + 自动部署） | 仅管理员电脑 |
| `delete_announcement` | 按「日期+标题」删公告 | 仅管理员电脑 |

读写分离的设计：查走线上地址（零门槛、永远最新）；写走管理员本地 Git（写权限由 GitHub 保证，别人想乱改也改不了）。

## 接入方法

### 方式一：一行命令（推荐，需要 Node.js ≥18）

在 ZCode / Claude Code 的 MCP 配置里加：

```json
{
  "mcpServers": {
    "campus-board": {
      "command": "npx",
      "args": ["-y", "github:WHMESSI-25/p5-campus-mcp"]
    }
  }
}
```

### 方式二：clone 到本地跑（管理员推荐）

```bash
git clone https://github.com/WHMESSI-25/p5-campus-mcp.git
cd p5-campus-mcp
npm install
```

配置里把 command 换成本地路径：

```json
{
  "mcpServers": {
    "campus-board": {
      "command": "node",
      "args": ["D:\\projects\\p5-campus-mcp\\index.js"]
    }
  }
}
```

> 管理员记得设 `P2_REPO_PATH` 环境变量指向公告板仓库（默认 `D:\projects\p2-mytool`，不设也行）。

### 接入后试试对 agent 说

- 「查一下最新的公告」
- 「搜一下有没有关于考试的公告」
- 「帮我发条公告：明天下午停水，标题叫停水通知，署名后勤处」（仅管理员电脑）

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `P2_REPO_PATH` | `D:\projects\p2-mytool` | 公告板本地仓库路径（写操作用） |

## 实测记录

- 冒烟测试（`npm test`）：初始化 / 4 工具注册 / 读线上数据 / 关键词搜索 —— 全过
- 写操作实测：发布→确认在列表→删除→确认消失，完整生命周期真实推送 2 轮（git 历史：`发布公告：MCP连通性测试` ×2、`删除公告：MCP连通性测试` ×2）
- 网络被墙时所有写操作返回人话报错（「网络不通的窗口期，稍后再试」），不会崩
