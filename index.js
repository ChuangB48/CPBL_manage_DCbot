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

    const matchData = await page.evaluate(() => {
      // 這次我們只抓取含有 GAME 編號且文字行數在 5-10 行之間的元素
      // 這能精準排除掉那個超長的總覽區塊 (場次 6)
      const elements = Array.from(document.querySelectorAll('div'));
      const validCards = elements.filter(el => {
        const text = el.innerText;
        return text.includes('GAME') && 
               text.split('\n').length >= 5 && 
               text.split('\n').length <= 12;
      });

      // 取得文字內容並去重
      const rawMatches = validCards.map(el => el.innerText.trim());
      return [...new Set(rawMatches)];
    });

    await browser.close();

    let output = `📢 **中華職棒 完整戰況資訊**\n\n`;
    
    matchData.forEach((matchText, idx) => {
      // 進行時間校正與格式整理
      const lines = matchText.split('\n').map(l => l.trim()).filter(Boolean);
      const cleanLines = lines.map(l => l === '02:35' ? '17:35' : l);
      
      output += `⚾ **比賽 ${idx + 1}**\n`;
      cleanLines.forEach(line => output += `> ${line}\n`);
      output += `───────────────────\n`;
    });

    await sendToDiscord(output);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();