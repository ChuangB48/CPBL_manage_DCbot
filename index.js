const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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
  console.log(`🌐 正在載入 CPBL 官網首頁解析一軍賽況 [${todayStr}]...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto('https://www.cpbl.com.tw/', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // 等待 3 秒確保首頁 Vue 元件完全展開
    await new Promise(r => setTimeout(r, 3000));

    // 解析一軍賽事看板
    const result = await page.evaluate(() => {
      const majorList = document.querySelector('.IndexScheduleList.major');
      if (!majorList) {
        return { hasGames: false, rawText: "無法定位一軍賽事區塊" };
      }

      const majorText = majorList.innerText.trim();
      if (majorText.includes("本日尚無比賽") || majorText === "") {
        return { hasGames: false, rawText: "本日尚無比賽" };
      }

      // 當有比賽時，擷取每一個 game_item
      const games = [];
      const items = majorList.querySelectorAll('.game_item');

      items.forEach(item => {
        const lines = item.innerText.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          games.push(lines.join(' | '));
        }
      });

      return {
        hasGames: games.length > 0,
        games: games
      };
    });

    await browser.close();

    // 組織推播訊息
    let messageContent = "";
    if (result.hasGames && result.games && result.games.length > 0) {
      const matchCards = result.games.map((gText, idx) => {
        return `⚾ **賽事 ${idx + 1}**\n📝 **即時戰況**：${gText}`;
      });
      messageContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 今日 (${todayStr}) 中華職棒官方首頁顯示：**本日尚無比賽**（休兵日或賽程已結束）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官網首頁賽事實況 (${todayStr})**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播官網賽事至 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();