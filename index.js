const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
  for (const chunk of chunks) {
    await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto('https://stats.cpbl.com.tw/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    // 抓取所有包含 "GAME" 的 div，不做任何篩選直接回傳
    const allRawMatches = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('div'));
      return elements
        .filter(el => el.innerText.includes('GAME'))
        .map(el => el.innerText.trim());
    });

    await browser.close();

    let output = `📢 **【原始全量抓取資料】共抓到 ${allRawMatches.length} 個區塊**\n\n`;
    
    allRawMatches.forEach((text, idx) => {
      output += `--- 區塊 ${idx + 1} ---\n`;
      output += text + `\n\n`;
    });

    await sendToDiscord(output);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();