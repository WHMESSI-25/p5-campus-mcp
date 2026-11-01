#!/usr/bin/env node
// 冒烟测试：用 MCP 协议（JSON-RPC over stdio）直接和 server 对话
// 验证：初始化 → 列工具 → 调用 get_announcements / search_announcements
import { spawn } from "node:child_process";

const child = spawn("node", ["index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  // 逐行解析 JSON-RPC 响应（可能一条 chunk 里有多条）
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch { /* 忽略无法解析的行 */ }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[server] " + d.toString()));

function rpc(method, params) {
  const id = nextId++;
  const p = new Promise((res) => pending.set(id, res));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}
function callTool(name, args) {
  return rpc("tools/call", { name, arguments: args });
}

const fail = (m) => { console.error("❌ " + m); child.kill(); process.exit(1); };

// 1. 初始化握手
const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "1.0.0" },
});
if (!init.result?.serverInfo) fail("初始化失败");
console.log("✅ 初始化成功：", init.result.serverInfo.name, init.result.serverInfo.version);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

// 2. 列工具
const tools = await rpc("tools/list", {});
const names = tools.result.tools.map((t) => t.name);
console.log("✅ 工具列表：", names.join(", "));
for (const expect of ["get_announcements", "search_announcements", "publish_announcement", "delete_announcement"]) {
  if (!names.includes(expect)) fail(`缺少工具 ${expect}`);
}

// 3. 调用查公告（走真实线上数据）
const got = await callTool("get_announcements", {});
const gotText = got.result?.content?.[0]?.text ?? "";
if (got.result?.isError) fail("get_announcements 报错：" + gotText);
console.log("✅ get_announcements →", gotText.split("\n")[0]);

// 4. 关键词搜索
const kw = "考试";
const found = await callTool("search_announcements", { keyword: kw });
const foundText = found.result?.content?.[0]?.text ?? "";
if (found.result?.isError) fail("search_announcements 报错：" + foundText);
console.log(`✅ search_announcements(${kw}) →`, foundText.split("\n")[0]);

console.log("\n🎉 冒烟测试全部通过");
child.kill();
process.exit(0);
