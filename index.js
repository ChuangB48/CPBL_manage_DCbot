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
  // 若訊息過長切段發送
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

  const dateInfo = getTaiwanDate();
  const targetUrl = ['https://', 'stats.', 'cpbl.', 'com.', 'tw/'].join('');
  console.log("🌐 正在載入 CPBL 數據中心精準抓取賽事卡片: " + targetUrl);

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

    // 透過精準尋找賽事卡片容器來提取完整資訊
    const matches = await page.evaluate(() => {
      const gameCards = [];
      
      // 尋找所有包含比賽項目的區塊（依據常見的賽事清單結構）
      // 我們抓取包含「例行賽」或隊伍對戰的區塊
      const elements = document.querySelectorAll('div');
      
      elements.forEach(el => {
        const text = el.innerText || '';
        // 篩選出單一賽事卡片的特徵（包含聯盟類型、客隊、主隊與場地）
        if ((text.includes('一軍例行賽') || text.includes('二軍例行賽')) && text.includes('vs')) {
          // 確保這是最外層或適當大小的卡片容器，避免重複抓取子元素
          if (el.children.length < 15 && text.length < 300) {
            const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
            if (lines.length >= 3) {
              gameCards.push({
                rawLines: lines
              });
            }
          }
        }
      });

      // 濾除重複的容器
      const uniqueCards = [];
      const seen = new Set();
      gameCards.forEach(card => {
        const key = card.rawLines.join('|');
        if (!seen.has(key)) {
          seen.add(key);
          uniqueCards.push(card.rawLines);
        }
      });

      return uniqueCards;
    });

    await browser.close();

    let output = `📢 **中華職棒 賽事實況看板 (${dateInfo.full})**\n\n`;

    if (matches && matches.length > 0) {
      matches.forEach((lines, idx) => {
        output += `⚾ **場次 ${idx + 1}**\n`;
        lines.forEach(line => {
          output += `> ${line}\n`;
        });
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${dateInfo.full}) 官方未排定賽事或結構尚未載入。\n`;
    }

    console.log("✅ 精準賽事解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();