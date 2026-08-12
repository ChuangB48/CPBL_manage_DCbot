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

async function sendToDiscordInChunks(title, items) {
  let currentChunk = `📋 **${title}**\n\`\`\`text\n`;

  for (const item of items) {
    const line = `${item.text.padEnd(12, ' ')} ➔ ${item.href}\n`;
    if ((currentChunk + line).length > 1800) {
      currentChunk += '```';
      await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
      await new Promise(r => setTimeout(r, 800));
      currentChunk = `📋 **${title} (接續)**\n\`\`\`text\n`;
    }
    currentChunk += line;
  }

  if (!currentChunk.endsWith('```')) {
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
  console.log(`🌐 正在載入 CPBL 首頁提取所有導覽連結與路徑 [${todayStr}]...`);

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

    await page.goto('[https://www.cpbl.com.tw/](https://www.cpbl.com.tw/)', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await new Promise(r => setTimeout(r, 3000));

    // 抓取首頁上所有 a 標籤的文字與 href
    const allLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a').forEach(a => {
        const text = (a.innerText || a.getAttribute('title') || '').trim().replace(/\n+/g, ' ');
        const href = a.href || '';
        if (text && href && !href.startsWith('javascript:')) {
          links.push({ text, href });
        }
      });
      return links;
    });

    await browser.close();

    console.log(`✅ 成功抓取到 ${allLinks.length} 個首頁導覽連結！正在推送至 Discord...`);
    await sendToDiscordInChunks(`【CPBL 官網首頁所有可用真實連結】(${todayStr})`, allLinks);
    console.log("🎉 發送完成！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();