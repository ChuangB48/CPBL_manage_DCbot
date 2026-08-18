// roster.js
process.env.TZ = 'Asia/Taipei';
const axios = require('axios');
const { fetchRosterMovements } = require('./scraper');

const DISCORD_ROSTER_WEBHOOK_URL = process.env.DISCORD_ROSTER_WEBHOOK_URL;

function getTodayStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

function getTodayFormats() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1);
  const d = String(now.getDate());

  return [
    `${yyyy}/${mm}/${dd}`,
    `${yyyy}-${mm}-${dd}`,
    `${mm}/${dd}`,
    `${m}/${d}`,
    `${m}月${d}日`
  ];
}

async function main() {
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 開始抓取球員異動...`);
  
  try {
    const newsList = await fetchRosterMovements();
    const todayStr = getTodayStr();
    const todayFormats = getTodayFormats();

    // 比對今日新聞
    const todayNews = newsList.filter(item => {
      const newsContent = `${item.date} ${item.title}`;
      return todayFormats.some(fmt => newsContent.includes(fmt));
    });

    let output = '';

    if (todayNews.length > 0) {
      // 有異動時的訊息
      output = `📋 **【CPBL 中華職棒】今日球員異動通知 (${todayStr})**\n\n`;
      todayNews.forEach((news) => {
        output += `🔹 **${news.title}**\n🔗 [點此查看詳細公告](${news.url})\n\n`;
      });
    } else {
      // 無異動時發送通知
      output = `ℹ️ **【CPBL 中華職棒】球員異動通知 (${todayStr})**\n> 今日尚無球員異動公告。`;
    }

    if (DISCORD_ROSTER_WEBHOOK_URL) {
      await axios.post(DISCORD_ROSTER_WEBHOOK_URL, { content: output });
      console.log("✅ 異動訊息已發送至專屬頻道！");
    } else {
      console.error("❌ 錯誤：未找到 DISCORD_ROSTER_WEBHOOK_URL 環境變數。");
    }
  } catch (error) {
    console.error("❌ 抓取球員異動失敗:", error);
  }
}

main();