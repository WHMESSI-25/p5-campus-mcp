#!/usr/bin/env node
// 写操作实测：publish → 验证上线列表 → delete → 验证消失
// 会真实推送到 GitHub 并触发自动部署
import { spawn } from "node:child_process";

const child = spawn("node", ["index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* 忽略 */ }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const p = new Promise((res) => pending.set(id, res));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}
const callTool = (name, args) => rpc("tools/call", { name, arguments: args });
const fail = (m) => { console.error("❌ " + m); child.kill(); process.exit(1); };

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "write-test", version: "1.0.0" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const TITLE = "MCP连通性测试";

// 0. 清场：如果上次测试有残留（发布成功但删除没跑），先删掉，忽略报错
const cleanup = await callTool("delete_announcement", { date: new Date().toISOString().slice(0, 10), title: TITLE });
console.log("（清场：" + (cleanup.result?.isError ? "无残留" : "已清除上次残留") + "）");

// 1. 发布
const pub = await callTool("publish_announcement", {
  title: TITLE,
  content: "这条是 P5 MCP Server 的自动测试公告，验证发布工具后会立即删除。",
  author: "P5测试机器人",
});
const pubText = pub.result?.content?.[0]?.text ?? "";
if (pub.result?.isError) fail("发布失败：" + pubText);
console.log("✅ publish →", pubText);

// 2. 查一下确认在列表里
const got = await callTool("get_announcements", {});
const gotText = got.result?.content?.[0]?.text ?? "";
if (!gotText.includes(TITLE)) fail("发布后列表里没找到测试公告");
console.log("✅ get → 列表中已出现测试公告");

// 3. 删除
const del = await callTool("delete_announcement", { date: new Date().toISOString().slice(0, 10), title: TITLE });
const delText = del.result?.content?.[0]?.text ?? "";
if (del.result?.isError) fail("删除失败：" + delText);
console.log("✅ delete →", delText);

// 4. 再查确认消失
const got2 = await callTool("get_announcements", {});
const got2Text = got2.result?.content?.[0]?.text ?? "";
if (got2Text.includes(TITLE)) fail("删除后列表里还有测试公告");
console.log("✅ get → 测试公告已消失");

console.log("\n🎉 写操作全生命周期测试通过（发布→在→删除→无）");
child.kill();
process.exit(0);
