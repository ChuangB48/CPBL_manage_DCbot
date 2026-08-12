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
  console.log(`==================================================`);
  console.log(`🔍 [DEBUG 模式] 開始全量探測 CPBL 官網資料 [${todayStr}]`);
  console.log(`==================================================\n`);

  let debugLog = [];
  const log = (msg) => {
    console.log(msg);
    debugLog.push(msg);
  };

  // ----------------------------------------------------
  // 1. 探測官方 API 端點
  // ----------------------------------------------------
  log("【1. 官方 API 接口測試】");
  try {
    const apiUrl = `https://www.cpbl.com.tw/home/getgamelist?GameDate=${encodeURIComponent(todayStr)}&KindCode=A`;
    const res = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.cpbl.com.tw/'
      },
      timeout: 10000
    });
    log(`HTTP 狀態碼: ${res.status}`);
    log(`回傳內容型態: ${typeof res.data}`);
    log(`原始回傳 JSON:\n${JSON.stringify(res.data, null, 2)}`);
  } catch (err) {
    log(`API 請求失敗: ${err.message}`);
  }

  log("\n--------------------------------------------------\n");

  // ----------------------------------------------------
  // 2. 探測 Puppeteer 實體載入首頁 DOM 與 window 變數
  // ----------------------------------------------------
  log("【2. Puppeteer 官網首頁 DOM & 變數探測】");
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    await page.goto('https://www.cpbl.com.tw/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));

    const pageData = await page.evaluate(() => {
      // 擷取頂部賽事相關文字
      const scheduleNodes = [];
      document.querySelectorAll('.game_item, .IndexScheduleList, .ScheduleItem, [class*="game"], [class*="schedule"], .swiper-wrapper').forEach(el => {
        const text = (el.innerText || '').trim();
        if (text) scheduleNodes.push({ tag: el.tagName, class: el.className, text: text.replace(/\n+/g, ' | ') });
      });

      // 檢查 window 全域物件有無賽事變數
      const windowKeys = Object.keys(window).filter(k => 
        k.toLowerCase().includes('game') || 
        k.toLowerCase().includes('schedule') || 
        k.toLowerCase().includes('vue') ||
        k.toLowerCase().includes('data')
      );

      return {
        title: document.title,
        bodySnippet: document.body.innerText.slice(0, 500).replace(/\n+/g, ' '),
        scheduleNodes: scheduleNodes.slice(0, 10), // 取前 10 個
        windowKeys
      };
    });

    log(`頁面標題: ${pageData.title}`);
    log(`頁面 Body 前 500 字: ${pageData.bodySnippet}`);
    log(`抓到的賽事相關節點 (共 ${pageData.scheduleNodes.length} 個):\n${JSON.stringify(pageData.scheduleNodes, null, 2)}`);
    log(`全域相關變數名稱: ${JSON.stringify(pageData.windowKeys)}`);

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    log(`Puppeteer 探測失敗: ${err.message}`);
  }

  // ----------------------------------------------------
  // 3. 推送除錯報告至 Discord
  // ----------------------------------------------------
  const fullLogText = debugLog.join('\n');
  const discordMessage = fullLogText.length > 1800 
    ? fullLogText.slice(0, 1800) + "\n... (訊息過長，請查看 GitHub Actions Log 完整內容)"
    : fullLogText;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `🛠️ **CPBL 官網探測報告 (${todayStr})**\n\`\`\`text\n${discordMessage}\n\`\`\``
    });
    console.log("\n✅ 探測報告已成功發送至 Discord！");
  } catch (e) {
    console.error("發送 Discord 失敗:", e.message);
  }
}

main();