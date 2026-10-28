#!/usr/bin/env python3
"""修复 remote.js 的 onopen"""

path = "/home/ubuntu/geo-assistant-clean/harvester/routes/remote.js"
with open(path, "r") as f:
    content = f.read()

old = """  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    if (pushMode) {"""

new = """  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    reconnectDelay = 1000;
    lastMessageTime = performance.now();
    startDisconnectMonitor();
    if (pushMode) {"""

if old in content:
    content = content.replace(old, new)
    print("✅ onopen 已修复")
    with open(path, "w") as f:
        f.write(content)
else:
    print("❌ 未找到 onopen 模式")
    # 调试：打印 ws.onopen 附近的内容
    idx = content.find("ws.onopen")
    if idx != -1:
        print(f"  找到 ws.onopen 在位置 {idx}")
        print("  上下文:")
        print(repr(content[idx:idx+200]))
