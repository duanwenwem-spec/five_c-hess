# 方寸游局

一个无需下载、适配手机与电脑的轻量游戏站。目前包含五子棋和数字炸弹，两个游戏都支持单人挑战与好友在线房间。

## 游戏

- **五子棋**：入门、普通、困难三档电脑难度，也可创建六位房间号在线对弈。
- **数字炸弹**：自定义 1—9999 内的初始范围，与电脑或好友轮流猜数；每次猜测都会缩小范围，猜中炸弹者失败。

## 对弈难度

- **入门**：除直接取胜外会更自由地选择落点，适合第一次接触五子棋。
- **普通**：根据双方棋形进行攻守评分，会主动取胜并封堵直接威胁。
- **困难**：在攻守评分上额外预判下一轮威胁，减少落入陷阱并尝试形成连续攻势。

## 启动

```powershell
python app.py
```

Windows 用户也可以双击 `启动游戏.bat`。如果系统提示找不到 Python，请先从 Python 官网安装，并在安装界面勾选“Add Python to PATH”。

## 固定网址部署（推荐）

项目已经支持部署到 Cloudflare Workers：静态页面、AI 接口和在线房间都运行在同一个固定 `workers.dev` 网址上，房主电脑无需保持开机。

1. 将仓库连接到 Cloudflare Workers Builds。
2. 构建命令使用 `npm install`，部署命令使用 `npx wrangler deploy`。
3. 部署后，双方打开同一个固定网址；一方创建房间，另一方输入六位房间号。

Cloudflare 部署配置位于 `wrangler.jsonc`，房间后端位于 `worker/index.js`。每次推送到 GitHub 主分支后可以自动重新部署。

### `workers.dev` 网络受限时

可以从同一仓库再创建一个 Cloudflare Pages 项目：

- 构建命令：`exit 0`
- 输出目录：`static`
- 根目录：留空

首次部署后，在 Pages 项目的 **Settings → Bindings** 中添加 Service binding：变量名为 `BACKEND`，服务选择 `five-c-hess`，然后重新部署。`functions/api/[[path]].js` 会通过 Cloudflare 内部网络转发 API，访问者只需打开新的 `pages.dev` 地址。

## 本机临时联机（备用）

双击 `启动联机游戏.bat`，程序会自动启动本地服务和 Cloudflare 临时公网通道，并在浏览器打开在线对弈页面。第一次启动需要等待几秒钟。

1. 房主点击“在线对弈”并创建房间。
2. 将自动生成的临时公网网址或邀请链接发给另一位玩家。
3. 对方打开网址，输入房间号并点击“加入”。对方不需要安装 Python。
4. 房主执黑先行；双方可以在对局结束后邀请再来一局。

联机窗口必须保持开启。关闭窗口后公网地址和当前房间都会失效；下次启动会生成新的地址。`tools/cloudflared.exe` 是经过数字签名验证的 Cloudflare 官方客户端。

电脑浏览器打开 <http://127.0.0.1:8000>。

手机与电脑连接同一 Wi-Fi 后，先在电脑运行 `ipconfig` 找到 IPv4 地址，再在手机浏览器打开 `http://电脑IPv4地址:8000`，例如 `http://192.168.1.20:8000`。

## 测试

```powershell
python -m unittest -v
```

## 文件说明

- `app.py`：Python Web 服务、五子棋规则与电脑落子算法
- `static/index.html`、`static/hub.css`：游戏选择大厅
- `static/gomoku.html`、`static/game.js`、`static/style.css`：五子棋页面
- `static/bomb.html`、`static/bomb.js`、`static/bomb.css`：数字炸弹页面
- `static/style.css`：电脑/手机响应式界面
- `static/game.js`：棋盘交互与前端状态管理
- `test_app.py`：规则和 AI 的基础自动化测试
- `start_online.ps1`、`启动联机游戏.bat`：一键启动异网联机服务
