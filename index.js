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

// 切割字串以符合 Discord 單次 2000 字限制
async function sendToDiscordInChunks(title, content) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  let currentChunk = `📋 **${title}**\n\`\`\`text\n`;

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > 1800) {
      currentChunk += '```';
      await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
      await new Promise(r => setTimeout(r, 800)); // 避免觸發 rate limit
      currentChunk = `📋 **${title} (接續)**\n\`\`\`text\n`;
    }
    currentChunk += line + '\n';
  }

  if (currentChunk.trim() !== `📋 **${title}**\n\`\`\`` && currentChunk.trim() !== `📋 **${title} (接續)**\n\`\`\``) {
    currentChunk += '```';
    await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`==================================================`);
  console.log(`🌐 全量捕獲 CPBL 官網首頁與賽程頁文字 [${todayStr}]`);
  console.log(`==================================================\n`);

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

    // 1. 抓取官網首頁文字
    console.log("正在載入 CPBL 首頁 (https://www.cpbl.com.tw/)...");
    await page.goto('https://www.cpbl.com.tw/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));
    const homeText = await page.evaluate(() => document.body.innerText || '');

    // 2. 抓取官網賽程頁文字
    console.log("正在載入 CPBL 賽程頁 (https://www.cpbl.com.tw/schedule)...");
    await page.goto('https://www.cpbl.com.tw/schedule', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));
    const scheduleText = await page.evaluate(() => document.body.innerText || '');

    await browser.close();

    console.log("✅ 抓取完成，正在推送原始文字至 Discord...");

    // 推送首頁內容（擷取核心段落）
    await sendToDiscordInChunks(`【1. CPBL 官網首頁原始文字】(${todayStr})`, homeText.slice(0, 3500));

    // 推送賽程頁內容（擷取核心段落）
    await sendToDiscordInChunks(`【2. CPBL 賽程專頁原始文字】(${todayStr})`, scheduleText.slice(0, 4500));

    console.log("🎉 所有文字已全數送達 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();