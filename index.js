const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8)
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return `${yyyy}/${mm}/${dd}`;
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`🌐 啟動抗封鎖瀏覽器並監聽賽事封包 [${todayStr}]...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ]
  });

  let interceptedGames = [];

  try {
    const page = await browser.newPage();
    
    // 偽裝真實瀏覽器指紋，繞過 WAF 檢測
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // 核心大招：監聽所有網路回應，攔截官網 Vue 接收到的賽事 JSON
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('getgamelist') || url.includes('getschedule') || url.includes('Game') || url.includes('Schedule')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            console.log(`📡 成功攔截到賽事 API 封包: ${url}`);
            
            let list = [];
            if (Array.isArray(json)) list = json;
            else if (Array.isArray(json.GameADetail)) list = json.GameADetail;
            else if (Array.isArray(json.Games)) list = json.Games;
            else if (Array.isArray(json.list)) list = json.list;

            if (list.length > 0) {
              interceptedGames = list;
            }
          }
        } catch (e) {
          // 忽略非 JSON 或無法解析的封包
        }
      }
    });

    console.log("📡 正在載入 CPBL 官網首頁...");
    await page.goto('https://www.cpbl.com.tw/', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // 額外等待 3 秒讓非同步封包接收完成
    await new Promise(r => setTimeout(r, 3000));

    // 如果首頁沒抓到，前往賽程專頁再抓一次
    if (interceptedGames.length === 0) {
      console.log("📡 前往賽程頁進行二次監聽...");
      await page.goto('https://www.cpbl.com.tw/schedule', {
        waitUntil: 'networkidle2',
        timeout: 45000
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    // DOM 備用提取方案
    let domGames = [];
    if (interceptedGames.length === 0) {
      console.log("🔍 啟用 DOM 解析備援...");
      domGames = await page.evaluate(() => {
        const list = [];
        const items = document.querySelectorAll('.game_item, .IndexScheduleList .item, .ScheduleItem');
        items.forEach(el => {
          const text = el.innerText || '';
          if (text.includes('vs') || text.includes('VS') || text.includes(':')) {
            list.push(text.replace(/\n+/g, ' | '));
          }
        });
        return list;
      });
    }

    await browser.close();

    // 格式化推播卡片
    let matchCards = [];

    if (interceptedGames.length > 0) {
      console.log(`✅ 成功從 API 封包中獲取 ${interceptedGames.length} 場賽事資料！`);
      interceptedGames.forEach(game => {
        const away = game.VisitingTeamName || game.VisitingClubName || "客隊";
        const home = game.HomeTeamName || game.HomeClubName || "主隊";
        const awayScore = game.VisitingTotalScore ?? "-";
        const homeScore = game.HomeTotalScore ?? "-";
        const field = game.FieldAbbe || game.FieldName || "未定球場";
        const gameNo = game.GameSno ? `[第 ${game.GameSno} 場]` : "";

        let status = "🕒 賽前預告 / 未開打";
        if (game.GameStatus === 3 || (awayScore !== '-' && homeScore !== '-')) {
          status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 2) {
          status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
        }

        let extra = "";
        if (game.VisitingStartingPitcherName || game.HomeStartingPitcherName) {
          extra = `\n🥊 **預告先發**：${game.VisitingStartingPitcherName || '未定'} vs ${game.HomeStartingPitcherName || '未定'}`;
        }

        matchCards.push(
          `⚾ **${away}** vs **${home}** ${gameNo}\n` +
          `🏟️ **球場**：${field}\n` +
          `📌 **狀態**：${status}${extra}`
        );
      });
    } else if (domGames.length > 0) {
      domGames.forEach(gText => {
        matchCards.push(`⚾ **賽事資訊**：\n${gText}`);
      });
    }

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 中職官方未排定一軍賽事（可能為週一休兵日）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官方賽事實況看板 (${todayStr})**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播到 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();