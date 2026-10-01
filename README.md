# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：登记环志编号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21812>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（5 条业务路由 + 404） |
| 状态 | Pinia（ringStore / measureStore / siteStore / sessionStore / sightingStore） |
| 地图 | 高德地图 JS API（可选，按需动态加载）+ 本地 SVG 网格退化视图 |
| 存储 | IndexedDB（Dexie，库名 `gbbirdring-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 地图 key 说明（可选）

- 未配置 `VITE_AMAP_KEY`：`<SiteMap>` 渲染本地 SVG 网格视图，标记按生境配色落在对应格位，表单拾取坐标即落到格位中心；**构建与运行都不依赖该 key**。
- 配置后：`.env` 里填 `VITE_AMAP_KEY=<你的 key>`，再 `docker compose up -d --build`（compose 通过 build args 传入，Dockerfile 用 `ARG VITE_AMAP_KEY` 注入 Vite）。高德控制台需为该访问域名开启 JS API。

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21812
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射 / 可选 VITE_AMAP_KEY build arg
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT、可选 VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # ring-record / morphometrics / bird-site / session / patrol-sighting（+ ui.ts）
│       ├── stores/            # ringStore / measureStore / siteStore / sessionStore / sightingStore
│       ├── components/common/ # SiteMap / MeasureInput / RingCodeInput / SpeciesPicker / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useSiteFilter / useAmap
│       ├── pages/             # RingBoard / RingList / MeasureEntry / SiteList / SessionList / SightingList
│       ├── router/index.ts    # 路由表
│       └── utils/             # stats / geo / db / export（+ seed / id / plain / format / birds）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 鸟种数、初捕/重捕比、鸟点分布图、鸟种计数与生境分布 |
| `/rings` | 环志记录 | 金属环号 + 彩环双段录入与自动查重，重复时提示并跳转历史记录 |
| `/sightings` | 巡护目击对账 | 巡护侧随手记的彩环目击与站里环志档案按彩环组合对账：对上一只鸟即挂到该鸟名下，捕获经历与鸟点分布跟着算；对上多只或档案没有的留在待认领；核对失败两边都保住，重试只补没挂上的，挂错可撤回 |
| `/measure` | 量度测量 | 6 项量度带单位与范围校验，与同鸟种历史均值比对给出偏离提示 |
| `/sites` | 鸟点台账 | 地图 / SVG 网格双模式切换，表单拾取坐标即时落点，点位间距提示 |
| `/sessions` | 调查批次 | 观测条件录入，关闭批次后统计鸟种数、初捕数与重捕数 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`rings`、`morphs`、`sites`、`sessions`、`sightings`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段；`db.version(3)` 新增巡护目击表 `sightings`（`id, colorKey, claimStatus, sightingDate, siteId, linkedRingNo`），与环志档案各留一份、按彩环组合对账。升级前可用顶栏「导出备份」导出全量 JSON。
- 巡护目击对账规则：彩环写法（顺序 / 分隔符号）归一为颜色密钥后，与按金属环号归并的鸟组比对——恰好对上一只鸟则挂接（`claimStatus=linked`，记录 `linkedRingNo`），对上多只或档案中没有则留在待认领（`claimStatus=pending`，并记 `pendingReason`）。对账不删改任何一方数据；重试只处理待认领目击；撤回挂接后目击回到待认领、环志档案不动。
- 首次打开且表为空时写入示例数据（6 个鸟点、4 个调查批次、18 条环志记录、14 条量度与 6 条巡护目击）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
