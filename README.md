# RunNet

RunNet 是一个面向越野跑和超马用户的数据平台原型。当前版本提供 ITRA 跑者搜索、本地跑者库、跑者详情、能力画像、双人对比、赛事库和 AI 分析建议。

## 技术栈

- Node.js HTTP server
- 原生静态前端
- PostgreSQL 生产数据库
- SQLite 本地兜底数据库
- PM2 进程管理
- Nginx 反向代理

## 本地启动

```bash
npm install
npm start
```

默认访问：

```text
http://127.0.0.1:3000
```

如果 `3000` 被占用，可以临时换端口：

```bash
PORT=3001 npm start
```

Windows PowerShell:

```powershell
$env:PORT=3001
npm start
```

## 环境变量

复制 `.env.example` 作为生产环境参考。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Node 服务监听地址。使用 Nginx 时建议保持本机监听。 |
| `PORT` | `3000` | Node 服务端口。 |
| `DATABASE_URL` | 空 | 设置后使用 PostgreSQL；未设置时使用本地 `db.sqlite3`。 |
| `DATABASE_SSL` | `false` | Managed PostgreSQL 需要 SSL 时设为 `true`。 |

PostgreSQL 连接示例：

```text
DATABASE_URL=postgresql://runnet_user:strong_password@127.0.0.1:5432/runnet
```

DigitalOcean Managed PostgreSQL 通常可以使用类似：

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
DATABASE_SSL=true
```

## PostgreSQL 数据库

服务启动时会自动创建两张表：

- `runners`
- `races`

如果 PostgreSQL 表为空，服务会尝试从当前目录的 `db.sqlite3` 或 `data/runnet-data.sqlite` 导入已有跑者和赛事数据。没有旧数据时，会写入默认赛事样本。

## DigitalOcean Droplet 部署

推荐使用 Ubuntu Droplet。

### 1. 安装基础环境

```bash
sudo apt update
sudo apt install -y git nginx postgresql postgresql-contrib
```

安装 Node.js 22 或更新版本。可以使用 NodeSource、nvm 或系统包管理方式，只要满足 `node >= 22.5.0`。

安装 PM2：

```bash
sudo npm install -g pm2
```

### 2. 创建 PostgreSQL 数据库

```bash
sudo -u postgres psql
```

在 psql 中执行：

```sql
CREATE DATABASE runnet;
CREATE USER runnet_user WITH ENCRYPTED PASSWORD 'change_this_password';
GRANT ALL PRIVILEGES ON DATABASE runnet TO runnet_user;
\c runnet
GRANT ALL ON SCHEMA public TO runnet_user;
\q
```

### 3. 拉取项目并安装依赖

```bash
git clone YOUR_REPOSITORY_URL
cd YOUR_REPOSITORY/runnet
npm install
```

### 4. 配置生产环境变量

推荐在 PM2 ecosystem 中配置敏感变量，或在服务器 shell/profile 中导出。

临时测试方式：

```bash
export NODE_ENV=production
export HOST=127.0.0.1
export PORT=3000
export DATABASE_URL=postgresql://runnet_user:change_this_password@127.0.0.1:5432/runnet
npm start
```

确认能访问后停止前台进程，再使用 PM2。

### 5. 使用 PM2 启动

编辑 `ecosystem.config.cjs`，把 `DATABASE_URL` 加到 `env` 中，或在系统环境里提前导出。

```bash
npm run pm2:start
pm2 save
pm2 startup
```

常用命令：

```bash
npm run pm2:logs
npm run pm2:reload
pm2 status
```

### 6. 配置 Nginx

复制示例配置：

```bash
sudo cp deploy/nginx-runnet.conf /etc/nginx/sites-available/runnet
sudo ln -s /etc/nginx/sites-available/runnet /etc/nginx/sites-enabled/runnet
```

编辑域名：

```bash
sudo nano /etc/nginx/sites-available/runnet
```

把：

```nginx
server_name example.com www.example.com;
```

改成你的域名。

检查并重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 7. 配置 HTTPS

安装 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
```

签发证书：

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## App Platform 部署说明

如果使用 DigitalOcean App Platform，必须设置 `DATABASE_URL` 连接 PostgreSQL。不要依赖本地 SQLite 文件，因为 App Platform 的本地文件系统不适合保存长期数据。

## API

- `GET /api/health`
- `GET /api/itra/search`
- `GET /api/runners`
- `POST /api/runners`
- `GET /api/overview`
- `GET /api/races`
- `GET /api/compare`
- `GET /api/ai/analyze`

## 数据说明

- 跑者基础字段和最近赛事名来自 ITRA 搜索结果。
- UTMB Index、排名、完赛统计、能力画像和单场比赛指标当前属于平台估算。
- 生产环境建议使用 PostgreSQL，并定期备份数据库。
