const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  AlignmentType, LevelFormat, PageNumber, Footer, Header,
} = require('docx');
const fs = require('fs');
const path = require('path');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: '1677ff', type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: 'center',
    children: [new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 22, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
    })],
  });
}

function dataCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({ text, size: 21, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
    })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
  });
}

function p(text, options = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    ...options,
    children: [new TextRun({ text, size: 22, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' }, ...options.run })],
  });
}

function bullet(text, ref = 'bullets') {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80, line: 340 },
    children: [new TextRun({ text, size: 22, font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
  });
}

function tipBox(title, content) {
  return [
    new Paragraph({
      spacing: { before: 160, after: 80 },
      shading: { fill: 'E8F4FD', type: ShadingType.CLEAR },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: '1677ff' },
        top: { style: BorderStyle.NONE, size: 0 },
        bottom: { style: BorderStyle.NONE, size: 0 },
        right: { style: BorderStyle.NONE, size: 0 },
      },
      indent: { left: 200 },
      children: [
        new TextRun({ text: '💡 ' + title, bold: true, size: 22, color: '1677ff', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } }),
      ],
    }),
    new Paragraph({
      spacing: { after: 160 },
      shading: { fill: 'E8F4FD', type: ShadingType.CLEAR },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: '1677ff' },
        top: { style: BorderStyle.NONE, size: 0 },
        bottom: { style: BorderStyle.NONE, size: 0 },
        right: { style: BorderStyle.NONE, size: 0 },
      },
      indent: { left: 200 },
      children: [
        new TextRun({ text: content, size: 21, color: '1D2129', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } }),
      ],
    }),
  ];
}

const doc = new Document({
  styles: {
    default: {
      document: {
        run: {
          font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' },
          size: 22,
        },
      },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, color: '1D2129' },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0, keepNext: false, keepLines: false },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, color: '1D2129' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1, keepNext: false, keepLines: false },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, color: '1D2129' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2, keepNext: false, keepLines: false },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'numbers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'GEO 运营平台 - 使用手册', size: 18, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '第 ', size: 18, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } }),
            new TextRun({ text: ' 页', size: 18, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } }),
          ],
        })],
      }),
    },
    children: [
      // 封面
      new Paragraph({ spacing: { before: 3000 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: 'GEO 运营平台', bold: true, size: 56, color: '1677ff', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [new TextRun({ text: '云端节点管理 & Profile 使用手册', bold: true, size: 36, color: '1D2129', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: '芯图引擎 · GEO 运营平台', size: 24, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '版本 1.0', size: 22, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
      }),
      new Paragraph({ children: [new TextRun({ text: '', size: 22 })] }),

      // 目录说明
      ...tipBox('文档说明', '本文档介绍 GEO 运营平台的云端节点管理和浏览器 Profile 管理功能的使用方法，帮助运维人员快速掌握多节点部署和登录态管理操作。'),

      // ============ 第一章：云端节点管理 ============
      h1('第一章  云端节点管理'),

      h2('1.1 功能概述'),
      p('云端节点管理功能实现了多台服务器（节点）的统一管理、状态监控和批量部署。通过节点管理，您可以：'),
      bullet('查看所有节点的实时状态（在线/离线、平台数、活跃会话数）'),
      bullet('对单个或多个节点执行批量代码部署'),
      bullet('查看部署历史和执行结果'),
      bullet('支持按标签、节点名快速筛选'),

      h2('1.2 节点管理入口'),
      p('登录 GEO 运营平台后，在左侧导航栏点击「节点管理」菜单，即可进入节点管理页面。'),
      p('注意：节点管理菜单仅管理员角色可见。'),

      h2('1.3 节点列表页面'),

      h3('1.3.1 统计卡片'),
      p('页面顶部展示节点汇总统计：'),
      bullet('总节点数 — 当前注册的所有节点数量'),
      bullet('在线节点 — 当前心跳正常的节点数'),
      bullet('离线节点 — 超过 3 分钟未上报心跳的节点数'),
      bullet('活跃会话 — 所有节点当前正在运行的采集会话总数'),

      h3('1.3.2 节点列表'),
      p('每个节点卡片显示以下信息：'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [2400, 6606],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [headerCell('信息项', 2400), headerCell('说明', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('节点名称', 2400), dataCell('节点的可读名称，如"主服务器-单机01"', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('状态', 2400), dataCell('在线（绿色）/ 离线（红色）/ 未知', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('平台数', 2400), dataCell('该节点已配置凭证的平台数量', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('活跃会话', 2400), dataCell('当前正在运行的采集会话数', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('版本号', 2400), dataCell('节点上运行的代码版本', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('最后心跳', 2400), dataCell('最近一次心跳上报时间', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('标签', 2400), dataCell('节点分类标签，如 prod、master、worker', 6606)],
          }),
        ],
      }),

      h2('1.4 批量部署功能'),

      h3('1.4.1 创建部署批次'),
      p('点击页面右上角「批量部署」按钮，打开部署对话框：'),
      bullet('选择需要部署的目标节点（可多选）'),
      bullet('输入目标版本号或描述'),
      bullet('确认后创建部署批次'),

      h3('1.4.2 部署流程'),
      p('部署任务创建后，节点会在下一次心跳时拉取待执行的部署任务，并按以下步骤执行：'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [1200, 3600, 4206],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              headerCell('步骤', 1200),
              headerCell('操作', 3600),
              headerCell('说明', 4206),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('1', 1200),
              dataCell('拉取任务', 3600),
              dataCell('节点心跳时拉取 pending 状态的部署任务', 4206),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('2', 1200),
              dataCell('拉取最新代码', 3600),
              dataCell('执行 git pull 拉取最新代码', 4206),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('3', 1200),
              dataCell('安装依赖', 3600),
              dataCell('执行 npm install / pnpm install 安装依赖', 4206),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('4', 1200),
              dataCell('构建（前端）', 3600),
              dataCell('前端项目执行 npm run build', 4206),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('5', 1200),
              dataCell('重启服务', 3600),
              dataCell('使用 PM2 重启对应服务进程', 4206),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('6', 1200),
              dataCell('上报结果', 3600),
              dataCell('部署完成后上报成功或失败结果', 4206),
            ],
          }),
        ],
      }),

      h3('1.4.3 查看部署历史'),
      p('点击「部署历史」标签页，可查看所有部署批次记录，包括：'),
      bullet('批次名称和目标版本'),
      bullet('部署状态（待执行 / 进行中 / 成功 / 失败）'),
      bullet('每个节点的执行结果和耗时'),
      bullet('失败时的错误日志'),

      h2('1.5 新节点接入'),
      p('要将一台新服务器接入节点管理，需在目标机器上部署 node-agent：'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [1200, 7806],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [headerCell('步骤', 1200), headerCell('操作', 7806)],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('1', 1200),
              dataCell('复制 node-agent.js 到目标机器的部署目录', 7806),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('2', 1200),
              dataCell('设置环境变量：MAIN_SERVER_URL（主服务器地址）、NODE_ID（节点唯一ID）、NODE_NAME（节点名称）、HARVESTER_URL（本地 harvester 地址）', 7806),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('3', 1200),
              dataCell('使用 PM2 启动：pm2 start node-agent.js --name node-agent', 7806),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('4', 1200),
              dataCell('在主服务器节点管理页面确认新节点已上线', 7806),
            ],
          }),
        ],
      }),

      ...tipBox('节点 ID 命名规则', '建议使用 node-前缀 + 随机字符串，如 node-dc91b9a42895。节点 ID 是节点的唯一标识，同时也用作该节点默认凭证的 accountId，确保多节点凭证互不覆盖。'),

      // ============ 第二章：Profile 管理 ============
      h1('第二章  浏览器 Profile 管理'),

      h2('2.1 什么是 Profile'),
      p('浏览器 Profile 是持久化的浏览器用户数据目录，保存了登录态 Cookie、localStorage、缓存等信息。与纯 Cookie 模式相比，Profile 模式具有以下优势：'),
      bullet('更稳定的登录态 — 完整保留浏览器环境，不容易被检测为异常'),
      bullet('支持自动续期 — 可定期检查登录状态，自动刷新 Cookie'),
      bullet('多账号隔离 — 每个账号一个独立 Profile，互不干扰'),
      bullet('会话性能更好 — 启动新会话时可直接基于 Profile 启动，速度更快'),

      h2('2.2 Profile 管理入口'),
      p('登录 GEO 运营平台后，在左侧导航栏点击「Profile 管理」菜单，即可进入 Profile 管理页面。'),

      h2('2.3 Profile 列表页面'),

      h3('2.3.1 顶部统计'),
      p('页面顶部展示 Profile 汇总统计：'),
      bullet('总计 — 当前所有 Profile 数量'),
      bullet('已登录 — 最近检查确认处于登录状态的 Profile 数量'),
      bullet('未检查 — 尚未执行登录状态检查的 Profile 数量'),

      h3('2.3.2 Profile 卡片'),
      p('每个 Profile 以卡片形式展示，按平台分组。卡片包含以下信息：'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [2400, 6606],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [headerCell('信息项', 2400), headerCell('说明', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('账号名称', 2400), dataCell('Profile 对应的账号名称（优先显示凭证中的友好名称）', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('Profile 大小', 2400), dataCell('浏览器数据目录的占用空间', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('登录状态', 2400), dataCell('已登录 / 未登录 / 未检查 / 检查中', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('Cookie 数量', 2400), dataCell('关联凭证中的 Cookie 个数', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('凭证状态', 2400), dataCell('有效 / 已过期 / 无效', 6606)],
          }),
          new TableRow({
            cantSplit: true,
            children: [dataCell('最后验证', 2400), dataCell('关联凭证的最后验证日期', 6606)],
          }),
        ],
      }),

      ...tipBox('Cookie 凭证关联', '每个 Profile 会自动关联对应的 Cookie 凭证记录，通过平台 + 账号ID 匹配。卡片上显示的 Cookie 数量、凭证状态都来自关联的凭证数据，让您一眼就能看出这个 Profile 的登录态健康状况。'),

      h2('2.4 常用操作'),

      h3('2.4.1 检查登录状态'),
      p('点击 Profile 卡片上的「检查」按钮，系统会启动一个浏览器会话，使用该 Profile 访问对应平台，检测当前是否仍处于登录状态。'),
      p('检查完成后，卡片顶部会显示检查结果：'),
      bullet('已登录（绿色）— Profile 登录态有效'),
      bullet('未登录（红色）— Profile 登录态已失效，需要重新登录'),

      h3('2.4.2 续期登录态'),
      p('点击「续期」按钮，可对 Profile 进行登录态续期。续期操作会：'),
      bullet('启动浏览器加载该 Profile'),
      bullet('访问平台页面，检查登录状态'),
      bullet('如果已登录，刷新 Cookie 并更新凭证'),
      bullet('如果未登录，提示需要手动重新登录'),

      ...tipBox('关于续期', '在服务器环境（无图形界面）中，续期功能只能检查和刷新已有的登录态。如果账号已经退出登录，需要在有图形界面的机器上通过 Cookie 采集页面手动重新登录，生成新的 Profile。'),

      h3('2.4.3 一键续期全部'),
      p('点击页面右上角「一键续期全部」按钮，系统会依次检查所有 Profile 的登录状态，并更新每个 Profile 的健康状态。'),
      p('适合定期批量巡检，快速发现过期的登录态。'),

      h3('2.4.4 删除 Profile'),
      p('点击卡片上的删除图标，确认后可删除该 Profile。删除操作会：'),
      bullet('删除浏览器 Profile 数据目录（释放磁盘空间）'),
      bullet('同时删除关联的 Cookie 凭证记录'),
      p('注意：删除后无法恢复，需要重新通过 Cookie 采集页面登录生成新的 Profile。'),

      h2('2.5 Profile 是如何生成的'),
      p('Profile 是在 Cookie 采集过程中自动生成的：'),
      bullet('进入「Cookie 采集」页面，选择平台并启动采集'),
      bullet('系统启动一个浏览器会话（持久化模式）'),
      bullet('用户手动登录目标平台账号'),
      bullet('点击「提取 Cookie」按钮，系统自动保存：'),
      bullet('    • Cookie 凭证（同步到主服务器凭证库）'),
      bullet('    • 浏览器 Profile 目录（保存在 harvester 本地）'),
      bullet('Profile 目录命名格式：chrome-{账号ID}-{平台名}'),

      h2('2.6 Profile 与 Cookie 凭证的关系'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [2200, 3403, 3403],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              headerCell('对比项', 2200),
              headerCell('Cookie 凭证', 3403),
              headerCell('浏览器 Profile', 3403),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('存储位置', 2200),
              dataCell('主服务器数据库', 3403),
              dataCell('Harvester 本地文件系统', 3403),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('存储内容', 2200),
              dataCell('Cookie 字符串', 3403),
              dataCell('完整浏览器数据（Cookie、localStorage、缓存等）', 3403),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('登录稳定性', 2200),
              dataCell('一般，容易过期', 3403),
              dataCell('更稳定，接近真实浏览器', 3403),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('启动速度', 2200),
              dataCell('快', 3403),
              dataCell('稍慢（需加载完整 Profile）', 3403),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('适用场景', 2200),
              dataCell('简单操作、快速任务', 3403),
              dataCell('复杂操作、长时间任务', 3403),
            ],
          }),
          new TableRow({
            cantSplit: true,
            children: [
              dataCell('关联关系', 2200),
              dataCell('每个 Profile 对应一条凭证记录', 3403),
              dataCell('通过平台+账号ID与凭证关联', 3403),
            ],
          }),
        ],
      }),

      // ============ 第三章：常见问题 ============
      h1('第三章  常见问题'),

      h2('3.1 节点管理常见问题'),

      h3('Q1：节点显示离线怎么办？'),
      p('节点离线通常是 node-agent 进程异常退出或网络不通导致的。排查步骤：'),
      bullet('登录目标服务器，执行 pm2 list 查看 node-agent 进程状态'),
      bullet('如果进程已停止，查看日志：pm2 logs node-agent --lines 50'),
      bullet('检查网络：curl 主服务器地址/api/nodes/，确认能访问'),
      bullet('重启进程：pm2 restart node-agent'),

      h3('Q2：部署任务一直是 pending 状态？'),
      p('部署任务需要等待节点下一次心跳时拉取。默认心跳间隔 15 秒，如果超过 30 秒仍未开始：'),
      bullet('确认目标节点处于在线状态'),
      bullet('检查节点日志，看是否有拉取任务失败的报错'),
      bullet('尝试手动触发：pm2 restart node-agent 强制重新注册'),

      h3('Q3：部署失败了怎么办？'),
      p('在部署历史中点击失败的任务，查看错误日志。常见失败原因：'),
      bullet('Git 配置问题 — 当前分支没有设置 tracking branch，需手动配置'),
      bullet('依赖安装失败 — 网络问题或 package.json 变更'),
      bullet('构建失败 — 代码有语法错误或依赖缺失'),
      bullet('权限问题 — 进程没有写入权限'),

      h2('2.2 Profile 管理常见问题'),

      h3('Q1：Profile 管理页面显示 "Harvester service unavailable"'),
      p('这表示后端无法连接到 harvester 服务。排查步骤：'),
      bullet('确认 harvester 进程是否在运行：pm2 list'),
      bullet('检查 HARVESTER_URL 环境变量是否正确配置'),
      bullet('在服务器本地测试：curl http://localhost:3003/api/platforms'),
      bullet('如 harvester 已停止，启动：pm2 start harvester'),

      h3('Q2：Profile 显示「暂无关联 Cookie 凭证」'),
      p('这表示该 Profile 目录存在，但在凭证库中找不到对应的记录。可能原因：'),
      bullet('Profile 是旧版本遗留的数据，未同步到凭证库'),
      bullet('凭证已被手动删除，但 Profile 目录未清理'),
      bullet('账号 ID 不匹配 — 检查 Profile 目录名中的账号部分是否与凭证一致'),
      p('解决方法：可以删除该 Profile，然后通过 Cookie 采集页面重新登录生成。'),

      h3('Q3：登录状态检查失败或不准确？'),
      p('登录状态检查依赖平台页面的 DOM 选择器匹配，以下情况可能导致误判：'),
      bullet('平台页面改版，选择器失效 — 需要更新平台配置'),
      bullet('网络延迟导致页面未加载完成 — 可尝试再次检查'),
      bullet('Profile 目录损坏 — 删除后重新采集'),

      h3('Q4：如何在多节点环境中管理 Profile？'),
      p('Profile 存储在各个节点的 harvester 本地，不在主服务器集中存储。多节点环境下：'),
      bullet('每个节点独立维护自己的 Profile'),
      bullet('通过节点管理切换到不同节点，可查看对应节点的 Profile'),
      bullet('如需在节点间同步 Profile，需手动拷贝 browser-profiles 目录'),

      // 结尾
      new Paragraph({ spacing: { before: 600 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: '— 文档结束 —', size: 20, color: '86909C', font: { eastAsia: 'Microsoft YaHei', ascii: 'Arial' } })],
      }),
    ],
  }],
});

const outputPath = path.join('C:', 'Users', 'Administrator', 'Desktop', 'GEO云端节点管理与Profile使用手册.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log('✅ 文档已生成：' + outputPath);
});
