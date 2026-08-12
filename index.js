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

    // 抓取所有包含 "GAME" 的 div，並過濾掉包含整頁總覽的大容器
    const rawMatches = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      return allDivs
        .map(div => div.innerText.trim())
        .filter(text => text.includes('GAME') && text.includes('vs') && !text.includes('週三'));
    });

    await browser.close();

    // 透過 Set 與比對 GAME 編號來精準去除重複區塊
    const uniqueMatches = [];
    const seenGames = new Set();

    rawMatches.forEach(text => {
      // 擷取出類似 GAME258 的編號作為唯一識別碼
      const matchId = text.match(/GAME\d+/);
      const key = matchId ? matchId[0] : text;

      if (!seenGames.has(key)) {
        seenGames.add(key);
        uniqueMatches.push(text);
      }
    });

    let output = `📢 **中華職棒 賽況回報**\n\n`;
    
    if (uniqueMatches.length > 0) {
      uniqueMatches.forEach((matchText, idx) => {
        const lines = matchText.split('\n').map(l => l.trim()).filter(Boolean);
        const cleanLines = lines.map(l => l === '02:35' ? '17:35' : l);
        
        output += `⚾ **場次 ${idx + 1}**\n`;
        cleanLines.forEach(line => output += `> ${line}\n`);
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 目前無賽事資料。\n`;
    }

    await sendToDiscord(output);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();