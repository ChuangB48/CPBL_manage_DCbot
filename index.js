const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendToDiscord(title, content) {
  if (!DISCORD_WEBHOOK_URL) return;
  const chunk = `📋 **${title}**\n\`\`\`text\n${content.slice(0, 1800)}\n\`\`\``;
  await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
}

async function main() {
  const targetUrl = 'https://stats.cpbl.com.tw/';
  console.log(`🌐 正在抓取數據中心: ${targetUrl}`);

  try {
    // 模擬瀏覽器訪問數據中心
    const response = await axios.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
    });

    const $ = cheerio.load(response.data);
    
    // 抓取頁面主要內容 (例如：賽程表格、即時比分區塊)
    // 這裡嘗試抓取常見的表格或文字結構
    let results = '';
    $('table, .schedule, .live-score').each((_, el) => {
      results += $(el).text().replace(/\s+/g, ' ') + '\n';
    });

    if (!results) {
      // 若抓不到表格，抓取 body 內的核心文字
      results = $('body').text().replace(/\s+/g, ' ').slice(0, 1000);
    }

    await sendToDiscord('【CPBL 即時數據中心最新狀態】', results || '目前無賽事資訊');
    console.log("🎉 成功！");

  } catch (error) {
    console.error("❌ 失敗:", error.message);
  }
}

main();