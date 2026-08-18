// roster.js
process.env.TZ = 'Asia/Taipei';
const axios = require('axios');
const { fetchRosterMovements } = require('./scraper');

// 讀取專屬頻道的 Webhook 網址
const DISCORD_ROSTER_WEBHOOK_URL = process.env.DISCORD_ROSTER_WEBHOOK_URL;

function getTodayStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

async function main() {
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 開始抓取球員異動...`);
  
  try {
    const newsList = await fetchRosterMovements();
    const todayStr = getTodayStr();

    // 過濾出今日的異動新聞
    const todayNews = newsList.filter(item => item.date === todayStr || item.title.includes(todayStr));

    if (todayNews.length === 0) {
      console.log("今日尚無球員異動公告。");
      return;
    }

    let output = `📋 **【CPBL 中華職棒】今日球員異動通知 (${todayStr})**\n\n`;
    todayNews.forEach((news) => {
      output += `🔹 **${news.title}**\n🔗 [點此查看詳細公告](${news.url})\n\n`;
    });

    if (DISCORD_ROSTER_WEBHOOK_URL) {
      await axios.post(DISCORD_ROSTER_WEBHOOK_URL, { content: output });
      console.log("✅ 異動通知已成功發送至球員異動專屬頻道！");
    } else {
      console.error("❌ 未設定 DISCORD_ROSTER_WEBHOOK_URL，無法發送訊息。");
    }
  } catch (error) {
    console.error("抓取球員異動失敗:", error);
  }
}

main();