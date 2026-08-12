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
    dayNumber: parseInt(dd),
    monthStr: `${yyyy}-${mm}`
  };
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const dateInfo = getTaiwanDate();
  console.log(`🌐 正在深入解析 CPBL 官方月曆賽程表 [${dateInfo.full}]...`);

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

    // 前往官方賽程表
    await page.goto('https://www.cpbl.com.tw/schedule', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // 等待月曆 DOM 載入
    await new Promise(r => setTimeout(r, 4000));

    // 擷取月曆中所有的賽事節點
    const scheduleResult = await page.evaluate((currentDay) => {
      const todayList = [];
      const upcomingList = [];

      // 抓取所有日期格子（包含 class 含有 date, day, 或 td）
      const cells = document.querySelectorAll('.ScheduleCalendar td, .calendar_table td, td');

      cells.forEach(cell => {
        const text = cell.innerText.trim();
        if (!text) return;

        // 提取格子內的日期數字
        const dateMatch = text.match(/^(\d{1,2})/);
        const day = dateMatch ? parseInt(dateMatch[1]) : null;

        // 只要格子內有對戰或比賽資訊（包含時間 18:35 或 VS 或 球隊名稱）
        if (text.includes('18:') || text.includes('17:') || text.includes('14:') || text.includes('13:') || text.includes('VS') || text.includes('vs') || text.includes('延賽') || text.includes('場次')) {
          const cleanText = text.split('\n').map(l => l.trim()).filter(Boolean).join(' | ');

          if (day === currentDay) {
            todayList.push(cleanText);
          } else if (day && day > currentDay) {
            upcomingList.push({ day, info: cleanText });
          }
        }
      });

      // 若 td 解析不夠，直接備援抓取頁面上所有包含對戰字眼的區塊
      if (todayList.length === 0 && upcomingList.length === 0) {
        document.querySelectorAll('div, li, tr').forEach(el => {
          if (el.children.length > 8) return;
          const t = (el.innerText || '').trim();
          if ((t.includes('18:35') || t.includes('17:05')) && (t.includes('兄弟') || t.includes('獅') || t.includes('龍') || t.includes('悍將') || t.includes('桃猿') || t.includes('雄鷹'))) {
            upcomingList.push({ day: 0, info: t.split('\n').map(l => l.trim()).filter(Boolean).join(' | ') });
          }
        });
      }

      return {
        todayList,
        upcomingList: upcomingList.slice(0, 5)
      };
    }, dateInfo.dayNumber);

    await browser.close();

    // 組合訊息
    let output = "";
    if (scheduleResult.todayList.length > 0) {
      output += `📢 **中華職棒 今日官方賽事 (${dateInfo.full})**\n\n`;
      scheduleResult.todayList.forEach((m, idx) => {
        output += `⚾ **今日第 ${idx + 1} 場**\n📝 ${m}\n\n`;
      });
    } else {
      output += `📢 **中華職棒 賽事實況看板 (${dateInfo.full})**\n\n`;
      output += `ℹ️ 今日 (${dateInfo.full}) 官方未排定一軍例行賽。\n\n📅 **官方近期後續賽程**：\n\n`;
      
      if (scheduleResult.upcomingList.length > 0) {
        scheduleResult.upcomingList.forEach((item, idx) => {
          const dayLabel = item.day ? `【8月${item.day}日】` : `【近期場次 ${idx + 1}】`;
          output += `📌 **${dayLabel}**\n${item.info}\n\n───────────────\n\n`;
        });
      } else {
        output += `（當月剩餘賽程已全數完賽或官方尚未公佈更新）`;
      }
    }

    const payload = {
      content: output.trim()
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