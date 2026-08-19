// roster.js
process.env.TZ = 'Asia/Taipei';
const axios = require('axios');
const { fetchRosterMovements } = require('./scraper');

const DISCORD_ROSTER_WEBHOOK_URL = process.env.DISCORD_ROSTER_WEBHOOK_URL;

function getTaiwanDateFormats() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  
  const mNoZero = String(parseInt(month, 10));
  const dNoZero = String(parseInt(day, 10));

  // 中職官網常用格式（包含點號 2026.08.19）
  return [
    `${year}.${month}.${day}`,
    `${year}.${mNoZero}.${dNoZero}`,
    `${year}/${month}/${day}`,
    `${year}-${month}-${day}`,
    `${month}.${day}`,
    `${mNoZero}.${dNoZero}`,
    `${month}/${day}`,
    `${mNoZero}/${dNoZero}`,
    `${mNoZero}月${dNoZero}日`
  ];
}

async function main() {
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 開始抓取球員異動...`);
  
  try {
    const newsList = await fetchRosterMovements();
    console.log(`🔍 爬蟲成功抓到 ${newsList.length} 條相關新聞：`);
    newsList.forEach((n, i) => {
      console.log(`   ${i + 1}. 標題: "${n.title}" | 內文區塊: "${n.fullText}"`);
    });

    const todayFormats = getTaiwanDateFormats();
    console.log("📅 今日比對關鍵字：", todayFormats);

    // 同時比對 title 與 fullText
    const todayNews = newsList.filter(item => {
      const searchTarget = `${item.title} ${item.fullText}`;
      return todayFormats.some(fmt => searchTarget.includes(fmt));
    });

    let output = '';
    const now = new Date();
    const todayStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

    if (todayNews.length > 0) {
      output = `📋 **【CPBL 中華職棒】今日球員異動通知 (${todayStr})**\n\n`;
      todayNews.forEach((news) => {
        output += `🔹 **${news.title}**\n🔗 [點此查看詳細公告](${news.url})\n\n`;
      });
    } else {
      output = `ℹ️ **【CPBL 中華職棒】球員異動通知 (${todayStr})**\n> 今日尚無球員異動公告。`;
    }

    if (DISCORD_ROSTER_WEBHOOK_URL) {
      await axios.post(DISCORD_ROSTER_WEBHOOK_URL, { content: output });
      console.log("✅ 異動訊息已發送至頻道！");
    } else {
      console.error("❌ 錯誤：未找到 DISCORD_ROSTER_WEBHOOK_URL 環境變數。");
    }
  } catch (error) {
    console.error("❌ 抓取球員異動失敗:", error);
  }
}

main();