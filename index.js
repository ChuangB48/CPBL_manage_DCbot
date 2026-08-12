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

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  if (content.length > 1900) {
    const chunks = content.match(/[\s\S]{1,1900}/g) || [];
    for (const chunk of chunks) {
      await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    await axios.post(DISCORD_WEBHOOK_URL, { content: content });
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  const targetUrl = ['https://', 'stats.', 'cpbl.', 'com.', 'tw/'].join('');
  console.log("🌐 正在載入 CPBL 數據中心解析即時戰況: " + targetUrl);

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
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    // 給予充分時間讓即時戰況與比分元件完全渲染
    await new Promise(r => setTimeout(r, 6000));

    // 抓取每一列比賽卡片裡的所有文字，並依照圖片中的關鍵字進行乾淨過濾
    const matchBlocks = await page.evaluate(() => {
      const games = [];
      const textNodes = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      
      let i = 0;
      while (i < textNodes.length) {
        const text = textNodes[i];
        // 尋找包含比賽編號或「比賽中」的區塊
        if (text.match(/^\d+$/) && (textNodes[i+1] === '比賽中' || textNodes[i+1] === '已完賽' || textNodes[i+1] === '未開始')) {
          const gameNo = text;
          const status = textNodes[i+1];
          
          // 收集接下來直到下一個編號或結尾的文字
          const subLines = [];
          let j = i + 2;
          while (j < textNodes.length && !textNodes[j].match(/^\d+$/) && subLines.length < 25) {
            subLines.push(textNodes[j]);
            j++;
          }

          games.push({ gameNo, status, lines: subLines });
          i = j - 1;
        }
        i++;
      }
      return games;
    });

    await browser.close();

    let output = `📢 **中華職棒 即時賽況看板 (${todayStr})**\n\n`;

    if (matchBlocks && matchBlocks.length > 0) {
      matchBlocks.forEach((g) => {
        output += `⚾ **場次 ${g.gameNo}** [🔴 ${g.status}]\n`;
        output += `> ${g.lines.join(' ')}\n`;
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無即時賽況資料。\n`;
    }

    console.log("✅ 即時戰況解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();