# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：登记环志编号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布；秋迁巡护时志愿者隔水只看得到彩环，目击先记在「巡护记录」侧，回站后按彩环组合与环志档案对账。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

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
| 路由 | Vue Router 4（6 条业务路由 + 404） |
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
│       ├── types/             # ring-record / morphometrics / bird-site / session / sighting（+ ui.ts）
│       ├── stores/            # ringStore / measureStore / siteStore / sessionStore / sightingStore
│       ├── components/common/ # SiteMap / MeasureInput / RingCodeInput / SpeciesPicker / StatBadge / FilterBar / EmptyPanel / BirdProfileDrawer
│       ├── hooks/             # useSiteFilter / useAmap
│       ├── pages/             # RingBoard / RingList / PatrolReconcile / MeasureEntry / SiteList / SessionList
│       ├── router/index.ts    # 路由表
│       └── utils/             # stats.ts / geo.ts / db.ts / export.ts / reconcile.ts（+ seed.ts / id.ts / plain.ts / format.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 鸟种数、初捕/重捕比、鸟点分布图、鸟种计数与生境分布 |
| `/rings` | 环志记录 | 金属环号 + 彩环双段录入与自动查重，重复时提示并跳转历史记录 |
| `/patrol` | 巡护对账 | 巡护目击按彩环登记（两侧各留一份），按彩环组合与环志档案对账、撤回认领、查看鸟档案 |
| `/measure` | 量度测量 | 6 项量度带单位与范围校验，与同鸟种历史均值比对给出偏离提示 |
| `/sites` | 鸟点台账 | 地图 / SVG 网格双模式切换，表单拾取坐标即时落点，点位间距提示 |
| `/sessions` | 调查批次 | 观测条件录入，关闭批次后统计鸟种数、初捕数与重捕数 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`rings`、`morphs`、`sites`、`sessions`、`sightings`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段；`db.version(3)` 新增巡护目击表 `sightings`（巡护记录与环志档案分表各留一份）。升级前可用顶栏「导出备份」导出全量 JSON（备份含 sightings，旧备份恢复时该表留空）。
- 首次打开且表为空时写入示例数据（6 个鸟点、4 个调查批次、20 条环志记录、14 条量度与 7 条巡护目击，其中含一对多 / 档案缺失待认领样例）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。

## 巡护对账规则

- 志愿者隔水只看得到彩环：目击先登记到巡护侧（彩环组合 + 手记顺序/符号 + 鸟点 + 志愿者），初始为「待认领」。
- 「按彩环对账」在单事务内读环志档案、按归一化彩环组合（忽略分隔符/空格/大小写差异）匹配：
  - **唯一鸟命中**（同一金属环号去重后仅 1 只）→ 挂到该鸟名下，并快照环号/鸟种；
  - **一对多**（同一组合对应多只鸟）或 **档案缺失**（档案无此组合 / 无彩环）→ 继续留待认领并标明原因。
- 对账幂等可反复重试：已认领的不动，只补待认领；档案修正后重跑即可把新满足唯一命中的目击挂上。
- 点已认领头的环号可看「鸟档案」：捕获经历（初捕/重捕/回收时间线）与鸟点分布（捕获次数 + 已认领目击次数合并到鸟点）。
- 站里发现挂错可「撤回认领」：仅解除挂接，目击回到待认领（原因标记「已撤回」），巡护记录与环志档案均不删除，可重新对账。
- 对账在单个 Dexie 读写事务内完成，中途失败整体回滚，两边数据都不会被破坏。
