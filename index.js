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
  console.log(`🚀 啟動反反爬蟲模式，從官網首頁模擬點擊進入賽程專區 [${todayStr}]...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // 抹除機器人特徵
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // 1. 正常進入首頁獲取合法 Session
    console.log("1. 正在載入 CPBL 首頁...");
    await page.goto('https://www.cpbl.com.tw/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

    // 2. 模擬點擊首頁上的「賽程」導覽選單
    console.log("2. 正在從首頁點擊導航進入賽程專區...");
    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const scheduleLink = links.find(a => a.innerText && a.innerText.trim() === '賽程');
      if (scheduleLink) {
        scheduleLink.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 4000));
    } else {
      // 若無直接連結，使用合法 Referer 導向
      await page.goto('https://www.cpbl.com.tw/schedule', { waitUntil: 'networkidle2', timeout: 30000, referer: 'https://www.cpbl.com.tw/' });
      await new Promise(r => setTimeout(r, 4000));
    }

    const currentUrl = page.url();
    console.log(`當前所在頁面 URL: ${currentUrl}`);

    // 擷取賽程頁文字
    const pageText = await page.evaluate(() => document.body.innerText || '');

    await browser.close();

    console.log("✅ 成功獲取賽程專區內容，正在推送至 Discord...");
    await sendToDiscordInChunks(`【CPBL 官方真實賽程專區 (${currentUrl})】(${todayStr})`, pageText.slice(0, 5000));
    console.log("🎉 已推播至 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();