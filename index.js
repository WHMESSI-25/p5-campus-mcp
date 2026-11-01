#!/usr/bin/env node
// 校园公告板 MCP Server（P5 项目）
// 让任何支持 MCP 的 agent 直接查 / 发 / 删校园公告。
//
// 读：线上 https://whmessi-25.github.io/p2-mytool/announcements.json
//     （人人可查，数据永远最新，不需要 clone 仓库）
// 写：操作本地公告板仓库（默认 D:\projects\p2-mytool）的 git 并推送，
//     只有装了 Git 且有推送权限的机器（=管理员）能成功。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ===== 配置 =====
const LIVE_URL = "https://whmessi-25.github.io/p2-mytool/announcements.json";
// 管理员本地的公告板仓库路径，可用环境变量 P2_REPO_PATH 覆盖
const REPO_PATH = process.env.P2_REPO_PATH || "D:\\projects\\p2-mytool";
const DATA_FILE = `${REPO_PATH}\\public\\announcements.json`;

// ===== 小工具函数 =====

// 本地时区的今天，格式 YYYY-MM-DD
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 拉取线上最新公告（带时间戳绕过缓存）
async function fetchLive() {
  const resp = await fetch(`${LIVE_URL}?t=${Date.now()}`);
  if (!resp.ok) throw new Error(`线上数据请求失败：HTTP ${resp.status}`);
  return resp.json();
}

// 按日期从新到旧排序
function sortDesc(list) {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// 把公告列表整理成给 agent 看的文本
function formatList(list) {
  if (list.length === 0) return "公告板上目前没有任何公告。";
  return list
    .map((a, i) => {
      const img = a.image ? `\n   配图：${a.image}` : "";
      return `${i + 1}. [${a.date}] ${a.title}\n   正文：${a.content}\n   发布人：${a.author}${img}`;
    })
    .join("\n\n");
}

// 在公告板仓库里执行一条 git 命令
async function git(...args) {
  try {
    return await execFileAsync("git", args, { cwd: REPO_PATH, timeout: 60000 });
  } catch (err) {
    // 网络被墙时 git 的报错很啰嗦，翻译成人话
    const msg = String(err.message || err);
    if (/Could not resolve|Could not connect|Connection was reset|Recv failure/i.test(msg)) {
      throw new Error("网络不通（github.com 被墙的窗口期），稍等几分钟再试。");
    }
    throw new Error(msg);
  }
}

// 从本地仓库读公告数据（写操作前先 pull 保证是最新版）
async function readLocal() {
  const raw = await readFile(DATA_FILE, "utf-8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("本地 announcements.json 格式不对（不是数组）");
  return list;
}

// 写回本地仓库文件
async function writeLocal(list) {
  await writeFile(DATA_FILE, JSON.stringify(list, null, 2) + "\n", "utf-8");
}

// ===== MCP Server 与工具注册 =====

const server = new McpServer({
  name: "p5-campus-mcp",
  version: "1.0.0",
});

// 工具 1：查全部公告（人人可用，读线上）
server.tool(
  "get_announcements",
  "查询校园公告板上的全部公告（按日期从新到旧排列）",
  {},
  async () => {
    try {
      const list = sortDesc(await fetchLive());
      return { content: [{ type: "text", text: `共 ${list.length} 条公告：\n\n${formatList(list)}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  }
);

// 工具 2：按关键词搜公告（人人可用，读线上）
server.tool(
  "search_announcements",
  "在校园公告板中按关键词搜索（匹配标题和正文）",
  { keyword: z.string().describe("搜索关键词，比如：考试、放假、报名") },
  async ({ keyword }) => {
    try {
      const list = sortDesc(await fetchLive());
      const hit = list.filter(
        (a) => a.title.includes(keyword) || a.content.includes(keyword)
      );
      return {
        content: [{ type: "text", text: `搜到 ${hit.length} 条含「${keyword}」的公告：\n\n${formatList(hit)}` }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `❌ ${err.message}` }] };
    }
  }
);

// 工具 3：发布公告（仅管理员机器：走本地 git 提交并推送）
server.tool(
  "publish_announcement",
  "在校园公告板上发布一条新公告（仅公告管理员的电脑可用，推送后约 1-2 分钟全网生效）",
  {
    title: z.string().describe("公告标题，一句话说清这件事"),
    content: z.string().describe("公告正文"),
    author: z.string().describe("发布人，比如：教务处王老师"),
    date: z.string().describe("公告日期，格式 YYYY-MM-DD，不填就是今天").optional(),
    image_url: z.string().describe("配图链接（可选）").optional(),
  },
  async ({ title, content, author, date, image_url }) => {
    try {
      await git("pull", "--rebase", "origin", "main"); // 先同步，避免覆盖别人的更新
      const list = await readLocal();
      if (list.some((a) => a.date === (date || today()) && a.title === title)) {
        return { isError: true, content: [{ type: "text", text: "❌ 已存在同日期同标题的公告，换换个标题或日期。" }] };
      }
      const entry = { title, content, date: date || today(), author };
      if (image_url) entry.image = image_url;
      list.unshift(entry);
      await writeLocal(list);
      await git("add", "public/announcements.json");
      await git("commit", "-m", `发布公告：${title}`);
      await git("push");
      return {
        content: [{ type: "text", text: `✅ 公告「${title}」已推送，约 1-2 分钟全网生效（缓存上限 10 分钟）。` }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `❌ 发布失败：${err.message}` }] };
    }
  }
);

// 工具 4：删除公告（仅管理员机器：按「日期+标题」精确删除）
server.tool(
  "delete_announcement",
  "从校园公告板删除一条公告（仅公告管理员的电脑可用），需要提供该公告的日期和标题",
  {
    date: z.string().describe("要删除的公告日期，YYYY-MM-DD"),
    title: z.string().describe("要删除的公告标题（需完全一致）"),
  },
  async ({ date, title }) => {
    try {
      await git("pull", "--rebase", "origin", "main");
      const list = await readLocal();
      const next = list.filter((a) => !(a.date === date && a.title === title));
      if (next.length === list.length) {
        return { isError: true, content: [{ type: "text", text: `❌ 没找到 [${date}] 「${title}」这条公告。用 get_announcements 先查一下确切信息。` }] };
      }
      await writeLocal(next);
      await git("add", "public/announcements.json");
      await git("commit", "-m", `删除公告：${title}`);
      await git("push");
      return {
        content: [{ type: "text", text: `✅ 已删除 [${date}] 「${title}」，约 1-2 分钟全网生效。` }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `❌ 删除失败：${err.message}` }] };
    }
  }
);

// ===== 启动（stdio 传输：agent 通过标准输入输出与本服务通信） =====
const transport = new StdioServerTransport();
await server.connect(transport);
