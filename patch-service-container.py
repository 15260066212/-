"""Patch service-container.ts to remove nodes references (not deploying node management yet)"""
import re

with open("apps/server/src/service-container.ts", "r") as f:
    content = f.read()

# 移除 nodes 路由导入
content = re.sub(r'import.*from.*routes/nodes.*\n', '', content)
# 移除 node-registry 导入
content = re.sub(r'import.*from.*node-registry.*\n', '', content)
# 移除 nodes 路由注册行
content = re.sub(r'.*app\.route.*api/nodes.*\n', '', content)
# 移除 nodeRegistry 声明（如果有）
content = re.sub(r'.*nodeRegistry.*=.*\n', '', content)
# 移除 createNodeRoutes 参数（函数参数里的 nodeRegistry）
# 先不处理这个，因为可能导致函数参数问题

with open("apps/server/src/service-container.ts", "w") as f:
    f.write(content)

print("=== 修改完成，检查 profiles 相关行 ===")
for i, line in enumerate(content.split("\n"), 1):
    if "profile" in line.lower():
        print(f"  {i}: {line.strip()}")

print("\n=== 检查是否还有 nodes 相关 ===")
for i, line in enumerate(content.split("\n"), 1):
    if "node" in line.lower() and "node_modules" not in line.lower():
        print(f"  {i}: {line.strip()}")
