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
  console.log("🌐 正在載入 CPBL 數據中心精準解析賽況: " + targetUrl);

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

    // 透過智慧過濾文字陣列來辨識比賽狀態
    const matches = await page.evaluate(() => {
      const games = [];
      const textNodes = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      
      let i = 0;
      while (i < textNodes.length) {
        const text = textNodes[i];
        if (text.includes('例行賽') || text.includes('總冠軍賽') || text.includes('季後賽')) {
          const leagueType = text;
          // 向後收集接下來的幾行文字進行特徵比對
          const chunkLines = [];
          for (let j = 1; j <= 8; j++) {
            if (i + j < textNodes.length) {
              chunkLines.push(textNodes[i + j]);
            }
          }

          games.push({
            leagueType,
            lines: chunkLines
          });
        }
        i++;
      }
      return games;
    });

    await browser.close();

    let output = `📢 **中華職棒 賽事實況看板 (${todayStr})**\n\n`;

    if (matches && matches.length > 0) {
      matches.forEach((g, idx) => {
        output += `⚾ **場次 ${idx + 1}** [${g.leagueType}]\n`;
        
        // 依據內容智慧判定狀態
        const joined = g.lines.join(' ');
        if (joined.includes('未開始')) {
          output += `📌 **比賽狀態**：未開始\n`;
        } else if (joined.includes('完賽') || joined.includes('終場') || joined.includes('已結束')) {
          output += `🏁 **比賽狀態**：已完賽\n`;
        } else {
          output += `🔴 **比賽狀態**：進行中 / 實況中\n`;
        }

        output += `> ${g.lines.slice(0, 6).join(' | ')}\n`;
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 官方未排定一軍例行賽或查無賽事資料。\n`;
    }

    console.log("✅ 賽況解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();