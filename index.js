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
  const targetUrl = ['https://', 'stats.', 'cpbl.', 'com.', 'tw/'].join('');
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    const allMatches = await page.evaluate(() => {
      // 擴大篩選範圍，直接尋找包含關鍵資訊的節點，並保留所有子節點文字
      const cards = [];
      const gameElements = document.querySelectorAll('div');
      
      gameElements.forEach(el => {
        const text = el.innerText || '';
        // 條件：必須包含對戰與賽事編號，且是一個獨立的比賽卡片
        if (text.includes('vs') && text.includes('GAME')) {
          const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
          if (lines.length >= 3) cards.push(lines);
        }
      });
      return cards;
    });

    await browser.close();

    // 處理重複與過濾
    const uniqueMatches = [];
    const seen = new Set();
    allMatches.sort((a, b) => a.length - b.length);
    allMatches.forEach(c => {
      const signature = c.filter(l => l.includes('GAME')).join('|');
      if (signature && !seen.has(signature)) {
        seen.add(signature);
        uniqueMatches.push(c);
      }
    });

    let output = `📢 **中華職棒 完整賽況資訊 (${getTaiwanDate()})**\n\n`;
    
    uniqueMatches.forEach((lines, idx) => {
      // 校正時間邏輯
      const finalLines = lines.map(l => l.includes('02:35') ? l.replace('02:35', '17:35') : l);
      
      output += `⚾ **場次 ${idx + 1}**\n`;
      finalLines.forEach(line => output += `> ${line}\n`);
      output += `───────────────────\n`;
    });

    await sendToDiscord(output);
  } catch (error) {
    if (browser) await browser.close();
    console.error(error);
  }
}

main();