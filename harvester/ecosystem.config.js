/**
 * PM2 生态系统配置文件
 * 用于 harvester 进程的环境变量管理
 *
 * 启动方式：pm2 start ecosystem.config.js
 */

module.exports = {
  apps: [
    {
      name: 'harvester',
      script: 'server.js',
      cwd: './',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
        // 节点标识 - 确保每台机器的 NODE_ID 唯一
        // 部署时修改为当前机器的实际节点ID
        NODE_ID: process.env.NODE_ID || 'node-default',
        NODE_NAME: process.env.NODE_NAME || '单机节点',
        MAIN_SERVER_URL: process.env.MAIN_SERVER_URL || 'http://localhost:3000',
        CREDENTIALS_DIR: process.env.CREDENTIALS_DIR || './data',
        NOVNC_BASE_URL: '/novnc',
      },
    },
  ],
};
