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
  if (!DISCORD_WEBHOOK_URL) return;
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

  if (!currentChunk.endsWith('```')) {
    currentChunk += '```';
    await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  const targetUrl = '[https://stats.cpbl.com.tw/](https://stats.cpbl.com.tw/)';
  console.log(`🌐 正在使用 Puppeteer 載入 CPBL 數據中心: ${targetUrl} [${todayStr}]...`);

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
    
    // 前往數據中心
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // 等待前端 JS 渲染完成（給予 5 秒讓資料載入）
    console.log("⏳ 等待網頁動態渲染與 API 載入...");
    await new Promise(r => setTimeout(r, 5000));

    // 擷取渲染後的網頁主要文字
    const pageText = await page.evaluate(() => {
      // 移除 script 與 style 標籤干擾
      document.querySelectorAll('script, style').forEach(el => el.remove());
      return document.body.innerText || '';
    });

    await browser.close();

    console.log("✅ 成功獲取渲染後內容，正在推送至 Discord...");
    await sendToDiscordInChunks(`【CPBL 數據中心即時比分與賽程】(${todayStr})`, pageText);
    console.log("🎉 發送完成！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();