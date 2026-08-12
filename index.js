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

async function sendToDiscordInChunks(title, content) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  let currentChunk = `📋 **${title}**\n\`\`\`text\n`;

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > 1800) {
      currentChunk += '```';
      await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
      await new Promise(r => setTimeout(r, 800));
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
  console.log(`🌐 正在載入 CPBL 官方賽程專區 (/schedule/index) 與成績看板 (/box/index)...`);

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

    // 1. 抓取官方賽程專區 (/schedule/index)
    console.log("正在載入 https://www.cpbl.com.tw/schedule/index ...");
    await page.goto('https://www.cpbl.com.tw/schedule/index', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));
    const scheduleIndexText = await page.evaluate(() => document.body.innerText || '');

    // 2. 抓取官方成績/即時看板專區 (/box/index)
    console.log("正在載入 https://www.cpbl.com.tw/box/index ...");
    await page.goto('https://www.cpbl.com.tw/box/index', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));
    const boxIndexText = await page.evaluate(() => document.body.innerText || '');

    await browser.close();

    console.log("✅ 抓取完成，正在推送真實賽程與看板文字至 Discord...");

    // 推送 /schedule/index 內容
    await sendToDiscordInChunks(`【1. CPBL 賽程專區 /schedule/index】(${todayStr})`, scheduleIndexText.slice(0, 4000));

    // 推送 /box/index 內容
    await sendToDiscordInChunks(`【2. CPBL 比分看板 /box/index】(${todayStr})`, boxIndexText.slice(0, 4000));

    console.log("🎉 官方真實賽程與比分板文字已送達 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();