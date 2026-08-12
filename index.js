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
  console.log("🌐 正在載入 CPBL 數據中心解析戰況: " + targetUrl);

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

    // 以「比賽中」、「未開始」、「已完賽」作為錨點抓取周邊文字
    const gameBlocks = await page.evaluate(() => {
      const results = [];
      const textNodes = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      
      for (let i = 0; i < textNodes.length; i++) {
        const text = textNodes[i];
        if (text === '比賽中' || text === '未開始' || text === '已完賽') {
          // 往回找 4 行，往往前看 8 行，確保把比分、隊名、場地包進來
          const start = Math.max(0, i - 4);
          const end = Math.min(textNodes.length, i + 8);
          const sliceLines = textNodes.slice(start, end);
          
          results.push({
            status: text,
            lines: sliceLines
          });
        }
      }
      return results;
    });

    await browser.close();

    let output = `📢 **中華職棒 即時賽況看板 (${todayStr})**\n\n`;

    if (gameBlocks && gameBlocks.length > 0) {
      gameBlocks.forEach((g, idx) => {
        let badge = '📌';
        if (g.status === '比賽中') badge = '🔴';
        else if (g.status === '已完賽') badge = '🏁';

        output += `⚾ **賽事 ${idx + 1}** [${badge} ${g.status}]\n`;
        output += `> ${g.lines.join(' ')}\n`;
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無即時賽況資料。\n`;
    }

    console.log("✅ 戰況解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();