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

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  if (content.length > 1900) {
    const chunks = content.match(/[\s\S]{1,1900}/g) || [];
    for (const chunk of chunks) {
      await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    await axios.post(DISCORD_WEBHOOK_URL, { content: content });
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  const targetUrl = ['https://', 'stats.', 'cpbl.', 'com.', 'tw/'].join('');
  console.log("🌐 正在載入 CPBL 數據中心解析獨立賽事卡片: " + targetUrl);

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
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    // 在瀏覽器端精準尋找每一個獨立的賽事區塊
    const matches = await page.evaluate(() => {
      const games = [];
      const textNodes = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      
      // 尋找包含「例行賽」的索引，並向後取固定的欄位間距
      for (let i = 0; i < textNodes.length; i++) {
        const text = textNodes[i];
        if (text === '一軍例行賽' || text === '二軍例行賽' || text === '總冠軍賽' || text === '季後賽') {
          // 確保後面有足夠的行數組成一場比賽
          if (i + 6 < textNodes.length) {
            const leagueType = text;
            const awayTeam = textNodes[i + 1];
            const vs = textNodes[i + 2];
            const venue = textNodes[i + 3];
            const time = textNodes[i + 4];
            const homeTeam = textNodes[i + 5];
            const gameIdOrStatus = textNodes[i + 6];

            // 簡單驗證這是否為合法的對戰組合
            if (vs === 'vs' || vs === 'v/s') {
              games.push({
                leagueType,
                awayTeam,
                homeTeam,
                venue,
                time,
                gameIdOrStatus,
                status: textNodes[i + 7] || ''
              });
              // 跳過已經解析過的行，避免重複
              i += 6;
            }
          }
        }
      }
      return games;
    });

    await browser.close();

    let output = `📢 **中華職棒 賽事實況看板 (${todayStr})**\n\n`;

    if (matches && matches.length > 0) {
      matches.forEach((g, idx) => {
        const fullStatus = `${g.gameIdOrStatus} ${g.status}`.trim();
        output += `⚾ **場次 ${idx + 1}：${g.awayTeam} vs ${g.homeTeam}**\n`;
        output += `📌 **賽事類型**：${g.leagueType}\n`;
        output += `🏟️ **比賽場地**：${g.venue}\n`;
        output += `⏰ **開賽時間**：${g.time}\n`;
        output += `📊 **比賽狀態**：${fullStatus || '未開始'}\n`;
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 官方未排定一軍例行賽或查無賽事資料。\n`;
    }

    console.log("✅ 獨立賽事解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();