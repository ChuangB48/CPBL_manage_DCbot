const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));
  return `${twTime.getFullYear()}/${String(twTime.getMonth() + 1).padStart(2, '0')}/${String(twTime.getDate()).padStart(2, '0')}`;
}

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
  for (const chunk of chunks) {
    await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  const targetUrl = 'https://stats.cpbl.com.tw/';
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    // 等待動態資料載入
    await new Promise(r => setTimeout(r, 6000));

    // 1. 粗略抓取所有包含 "vs" 與 "GAME" 的區塊
    const rawMatches = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      return allDivs
        .map(div => div.innerText.trim())
        .filter(text => text.includes('GAME') && text.includes('vs'));
    });

    await browser.close();

    // 2. 核心邏輯：依照字串長度由短到長排序！(確保優先處理最乾淨的子容器)
    rawMatches.sort((a, b) => a.length - b.length);

    const uniqueMatches = [];
    const seenGames = new Set();

    // 3. 處理去重
    rawMatches.forEach(text => {
      const matchIds = text.match(/GAME\d+/g) || [];
      // 確保這個區塊只包含一場比賽的資訊
      if (matchIds.length === 1) {
        const gameId = matchIds[0];
        // 如果這個 GAME 編號還沒被收錄過，就加進去
        if (!seenGames.has(gameId)) {
          seenGames.add(gameId);
          uniqueMatches.push(text);
        }
      }
    });

    // 4. 準備輸出訊息
    const todayStr = getTaiwanDate();
    let output = `📢 **中華職棒 賽況回報 (${todayStr})**\n\n`;
    
    if (uniqueMatches.length > 0) {
      uniqueMatches.forEach((matchText, idx) => {
        // 清理多餘換行並校正時間
        const lines = matchText.split('\n').map(l => l.trim()).filter(Boolean);
        const cleanLines = lines.map(l => l === '02:35' ? '17:35' : l);
        
        output += `⚾ **場次 ${idx + 1}**\n`;
        cleanLines.forEach(line => output += `> ${line}\n`);
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
    }

    await sendToDiscord(output);
  } catch (error) {
    console.error("執行發生錯誤:", error);
    process.exit(1);
  }
}

main();