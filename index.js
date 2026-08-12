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

    // 精準鎖定：只抓取那些含有賽事編號的最小區塊，並排除掉包含 "賽程" 或 "週三" 的總覽容器
    const matchData = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      // 我們要的是那種結構單純、包含 "vs" 和 "GAME" 的最小單位
      const targetDivs = allDivs.filter(div => {
        const text = div.innerText;
        return text.includes('vs') && text.includes('GAME') && 
               !text.includes('週三') && !text.includes('今日');
      });

      // 篩選出最底層的節點（沒有其他子節點包含GAME的）
      const leafNodes = targetDivs.filter(div => {
        return !Array.from(div.children).some(child => child.innerText.includes('GAME'));
      });

      return leafNodes.map(el => el.innerText.trim());
    });

    await browser.close();

    let output = `📢 **中華職棒 賽況回報**\n\n`;
    
    matchData.forEach((matchText, idx) => {
      // 校正時間並過濾多餘換行
      const lines = matchText.split('\n').filter(l => l.trim() !== '');
      const cleanLines = lines.map(l => l === '02:35' ? '17:35' : l);
      
      output += `⚾ **場次 ${idx + 1}**\n`;
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