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

  return {
    full: `${yyyy}/${mm}/${dd}`,
    month: mm,
    day: dd,
    matchDateStr: `${parseInt(mm)}/${parseInt(dd)}`
  };
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const dateInfo = getTaiwanDate();
  console.log(`🌐 正在載入 CPBL 官方賽程頁面 [${dateInfo.full}]...`);

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

    // 直接造訪 CPBL 官方一軍賽程專頁
    await page.goto('https://www.cpbl.com.tw/schedule', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // 等待賽程表格完全渲染
    await new Promise(r => setTimeout(r, 4000));

    const scheduleData = await page.evaluate((targetDate) => {
      const todayMatches = [];
      const upcomingMatches = [];
      const teamList = ["中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹", "兄弟", "獅", "龍", "悍將", "桃猿", "雄鷹"];

      // 抓取賽程表格內的所有比賽列
      const rows = document.querySelectorAll('tr, .ScheduleTable tr, .game_list_table tr, .daily_schedule');

      rows.forEach(row => {
        const text = row.innerText || '';
        const hasTeam = teamList.filter(t => text.includes(t));

        if (hasTeam.length >= 2) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const cleanText = lines.join(' | ');

          // 判斷是否為今日賽事
          if (text.includes(targetDate)) {
            todayMatches.push(cleanText);
          } else {
            upcomingMatches.push(cleanText);
          }
        }
      });

      return {
        todayMatches,
        upcomingMatches: upcomingMatches.slice(0, 5) // 取近期前 5 場
      };
    }, dateInfo.matchDateStr);

    await browser.close();

    let outputCards = [];
    let titlePrefix = "";

    if (scheduleData.todayMatches.length > 0) {
      titlePrefix = `📢 **中華職棒 今日官方賽事實況 (${dateInfo.full})**\n\n`;
      scheduleData.todayMatches.forEach((match, idx) => {
        outputCards.push(`⚾ **今日賽事 ${idx + 1}**\n📝 **資訊**：${match}`);
      });
    } else {
      titlePrefix = `📢 **中華職棒 賽事實況看板 (${dateInfo.full})**\n\nℹ️ 今日官方未排定一軍例行賽。\n\n📅 **官方近期賽程預告**：\n\n`;
      if (scheduleData.upcomingMatches.length > 0) {
        scheduleData.upcomingMatches.forEach((match, idx) => {
          outputCards.push(`📌 **近期場次 ${idx + 1}**\n${match}`);
        });
      } else {
        outputCards.push("（目前賽程表暫無後續更新場次）");
      }
    }

    const payload = {
      content: `${titlePrefix}${outputCards.join('\n\n───────────────\n\n')}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播官方賽程至 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();