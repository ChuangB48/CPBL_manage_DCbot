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
    monthStr: `${mm}月${dd}日`
  };
}

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  await axios.post(DISCORD_WEBHOOK_URL, { content });
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL。");
    process.exit(1);
  }

  const dateInfo = getTaiwanDate();
  const targetUrl = ['https://', 'stats.', 'cpbl.', 'com.', 'tw/'].join('');
  console.log("🌐 正在載入 CPBL 數據中心解析當日賽事: " + targetUrl);

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
    await new Promise(r => setTimeout(r, 5000));

    const matches = await page.evaluate(() => {
      const gameCards = [];
      const textNodes = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      
      let i = 0;
      while (i < textNodes.length) {
        const curText = textNodes[i];
        if (curText.includes('例行賽') || curText.includes('總冠軍賽') || curText.includes('季後賽')) {
          const leagueType = curText;
          const awayTeam = textNodes[i + 1] || '';
          const vsText = textNodes[i + 2] || '';
          const venue = textNodes[i + 3] || '';
          const timeOrStatus = textNodes[i + 4] || '';
          const homeTeam = textNodes[i + 5] || '';
          const gameId = textNodes[i + 6] || '';

          if (awayTeam && homeTeam) {
            gameCards.push({
              leagueType,
              awayTeam,
              homeTeam,
              venue,
              timeOrStatus,
              gameId
            });
          }
        }
        i++;
      }
      return gameCards;
    });

    await browser.close();

    let output = `📢 **中華職棒 賽事實況看板 (${dateInfo.full})**\n\n`;

    if (matches && matches.length > 0) {
      matches.forEach((g, idx) => {
        output += `⚾ **場次 ${idx + 1}：${g.awayTeam} vs ${g.homeTeam}**\n`;
        output += `🏟️ **比賽場地**：${g.venue || '未指定'}\n`;
        output += `⏰ **開賽時間 / 狀態**：${g.timeOrStatus}\n`;
        
        if (g.timeOrStatus.includes('未開始')) {
          output += `📌 **預定狀態**：未開始\n`;
        } else if (g.timeOrStatus.includes('進行中') || g.timeOrStatus.includes('局')) {
          output += `🔴 **即時賽況**：比賽進行中\n`;
        } else {
          output += `🏁 **比賽結果**：已完賽\n`;
        }
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${dateInfo.full}) 官方未排定一軍例行賽或查無賽事資料。\n`;
    }

    console.log("✅ 賽事解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();