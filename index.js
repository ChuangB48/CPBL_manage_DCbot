const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) 的年、月、日、格式字串
function getTaiwanDateInfo() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return {
    year: String(yyyy),
    month: String(mm),
    day: String(dd),
    dateSlash: `${yyyy}/${mm}/${dd}`,
    dateShort: `${parseInt(mm)}/${parseInt(dd)}`
  };
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const dateInfo = getTaiwanDateInfo();
  console.log(`🌐 正在啟動瀏覽器載入 CPBL 賽程頁面 [${dateInfo.dateSlash}]...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    // 1. 直接導向賽程月曆頁面（資料最齊全、一定有排程）
    const scheduleUrl = `https://www.cpbl.com.tw/schedule?year=${dateInfo.year}&month=${dateInfo.month}&kindCode=A`;
    console.log(`📡 前往賽程頁: ${scheduleUrl}`);
    await page.goto(scheduleUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // 稍微等待 3 秒讓前端腳本跑完
    await new Promise(r => setTimeout(r, 3000));

    // 2. 從頁面 DOM 中擷取今日所有賽程節點
    const games = await page.evaluate((dateInfo) => {
      const results = [];
      const rows = document.querySelectorAll('.ScheduleList .game_item, .schedule_table tr, .Schedule-table tr, .calendar_table td, .game_box');

      // 支援的球隊名單關鍵字
      const teams = ["中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹", "兄弟", "獅", "龍", "悍將", "桃猿", "雄鷹"];

      // 方法 A：尋找頁面所有文字區塊
      document.querySelectorAll('div, tr, li, section').forEach(el => {
        const text = el.innerText || '';
        // 比對是否包含今天的日期 (例如 "08/12" 或 "8/12" 或 "2026/08/12")
        if ((text.includes(dateInfo.dateSlash) || text.includes(dateInfo.dateShort) || text.includes(`${dateInfo.month}/${dateInfo.day}`)) && text.includes('vs')) {
          // 確保是最小容器（避免抓到整個父層）
          if (el.children.length <= 8) {
            let matchedTeams = teams.filter(t => text.includes(t));
            if (matchedTeams.length >= 2) {
              const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
              results.push({
                rawText: lines.join(' | '),
                away: matchedTeams[0],
                home: matchedTeams[1]
              });
            }
          }
        }
      });

      // 去除重複比對項目
      const uniqueResults = [];
      const seen = new Set();
      for (const item of results) {
        const key = `${item.away}-${item.home}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueResults.push(item);
        }
      }

      return uniqueResults;
    }, dateInfo);

    await browser.close();

    console.log(`✅ 解析完成，找到 ${games.length} 場對戰！`);

    let matchCards = [];
    games.forEach(g => {
      matchCards.push(
        `⚾ **${g.away}** vs **${g.home}**\n` +
        `📝 **賽事資訊**：${g.rawText}`
      );
    });

    let messageContent = "";
    if (matchCards.length > 0) {
      messageContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 今日 (${dateInfo.dateSlash}) 官方賽程表無一軍賽事（休兵日或賽程已結束）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官方賽程看板 (${dateInfo.dateSlash})**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播今日賽事到 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();