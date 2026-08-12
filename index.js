const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY/MM/DD
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return `${yyyy}/${mm}/${dd}`;
}

// 隊伍 ID 對應表（中職官方代碼）
const TEAM_NAMES = {
  "1": "中信兄弟",
  "2": "統一7-ELEVEn獅",
  "3": "富邦悍將",
  "4": "味全龍",
  "5": "樂天桃猿",
  "6": "台鋼雄鷹",
  "A": "中信兄弟",
  "B": "統一7-ELEVEn獅",
  "E": "富邦悍將",
  "L": "味全龍",
  "AJL": "樂天桃猿",
  "TSG": "台鋼雄鷹"
};

// 方式一：官方 AJAX 接口直連
async function fetchFromOfficialApi(dateStr) {
  try {
    console.log(`📡 [通道 1] 正在向 CPBL 官方接口請求 [${dateStr}] 數據...`);
    const apiUrl = `https://www.cpbl.com.tw/home/getgamelist?GameDate=${encodeURIComponent(dateStr)}&KindCode=A`;
    
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.cpbl.com.tw/',
        'Origin': 'https://www.cpbl.com.tw'
      },
      timeout: 10000
    });

    let games = [];
    if (response.data && Array.isArray(response.data.GameADetail)) {
      games = response.data.GameADetail;
    } else if (Array.isArray(response.data)) {
      games = response.data;
    }

    if (games.length > 0) {
      console.log(`✅ [通道 1] 成功從官方接口獲取 ${games.length} 場賽事！`);
      return games.map(g => {
        const away = g.VisitingTeamName || TEAM_NAMES[g.VisitingTeamCode] || "客隊";
        const home = g.HomeTeamName || TEAM_NAMES[g.HomeTeamCode] || "主隊";
        const awayScore = (g.VisitingTotalScore !== undefined && g.VisitingTotalScore !== null) ? g.VisitingTotalScore : "-";
        const homeScore = (g.HomeTotalScore !== undefined && g.HomeTotalScore !== null) ? g.HomeTotalScore : "-";
        const field = g.FieldAbbe || g.FieldName || "官方球場";
        const gameNo = g.GameSno ? `[編號第 ${g.GameSno} 場]` : "";

        let status = "🕒 賽前預告 / 尚未開打";
        if (g.GameStatus === 3 || (awayScore !== '-' && homeScore !== '-')) {
          status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
        } else if (g.GameStatus === 2) {
          status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
        } else if (g.GameStatus === 4) {
          status = `🌧️ 因雨延賽`;
        }

        let extra = "";
        if (g.VisitingStartingPitcherName || g.HomeStartingPitcherName) {
          extra = `\n🥊 **預告先發**：${g.VisitingStartingPitcherName || '未定'} (客) vs ${g.HomeStartingPitcherName || '未定'} (主)`;
        }

        return `⚾ **${away}** vs **${home}** ${gameNo}\n🏟️ **球場**：${field}\n📌 **狀態**：${status}${extra}`;
      });
    }
  } catch (err) {
    console.log(`⚠️ [通道 1] 官方接口請求失敗: ${err.message}`);
  }
  return [];
}

// 方式二：Puppeteer 真實載入官網首頁解析
async function fetchFromOfficialPage() {
  console.log("🌐 [通道 2] 正在啟動 Puppeteer 真實載入 CPBL 官網首頁...");
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto('https://www.cpbl.com.tw/', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // 等待 4 秒確保官網首頁的 Vue 賽事清單全部完成掛載
    await new Promise(r => setTimeout(r, 4000));

    // 擷取首頁賽事看板內容
    const cards = await page.evaluate(() => {
      const results = [];
      const teams = ["中信兄弟", "統一獅", "統一7-ELEVEn獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹"];

      // 抓取首頁所有的賽事輪播項目
      const items = document.querySelectorAll('.game_item, .ScheduleItem, .IndexScheduleList .item, .swiper-slide');
      items.forEach(item => {
        const text = item.innerText || '';
        const matched = teams.filter(t => text.includes(t));
        if (matched.length >= 2) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          results.push(`⚾ **${matched[0]}** vs **${matched[1]}**\n📝 **首頁賽事實況**：${lines.join(' | ')}`);
        }
      });

      return [...new Set(results)];
    });

    await browser.close();
    return cards;
  } catch (err) {
    if (browser) await browser.close();
    console.error(`⚠️ [通道 2] 首頁渲染解析失敗: ${err.message}`);
    return [];
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`========================================`);
  console.log(`⚾ 開始執行 CPBL 官網賽事实況爬蟲 [${todayStr}]`);
  console.log(`========================================`);

  try {
    // 優先執行通道 1，若無資料則啟動通道 2
    let matchCards = await fetchFromOfficialApi(todayStr);

    if (matchCards.length === 0) {
      console.log("ℹ️ 通道 1 未獲取到賽事，切換至通道 2 (Puppeteer 官網渲染)...");
      matchCards = await fetchFromOfficialPage();
    }

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 中華職棒官方首頁未排定一軍賽事（可能為週一例行休兵日或賽程已結束）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官網即時賽程實況 (${todayStr})**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播官方即時賽事至 Discord！");

  } catch (error) {
    console.error("❌ 執行主程式發生例外:", error.message);
    process.exit(1);
  }
}

main();