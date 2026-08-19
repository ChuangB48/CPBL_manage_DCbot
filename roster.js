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

  // 涵蓋各種可能的日期格式
  return [
    `${year}/${month}/${day}`,
    `${year}/${mNoZero}/${dNoZero}`,
    `${year}.${month}.${day}`,
    `${year}.${mNoZero}.${dNoZero}`,
    `${year}-${month}-${day}`,
    `${month}/${day}`,
    `${mNoZero}/${dNoZero}`,
    `${mNoZero}月${dNoZero}日`
  ];
}

async function main() {
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 開始抓取 CPBL 球員異動...`);
  
  try {
    const records = await fetchRosterMovements();
    const todayFormats = getTaiwanDateFormats();

    // 篩選出包含今天日期的異動紀錄
    const todayRecords = records.filter(item => {
      return todayFormats.some(fmt => item.text.includes(fmt));
    });

    let output = '';
    const now = new Date();
    const todayStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

    if (todayRecords.length > 0) {
      output = `📋 **【CPBL 中華職棒】今日球員異動通知 (${todayStr})**\n\n`;
      todayRecords.forEach(rec => {
        output += `🔹 ${rec.text}\n`;
      });
      output += `\n🔗 [點此前往官網異動專區](https://www.cpbl.com.tw/player/trans)`;
    } else {
      output = `ℹ️ **【CPBL 中華職棒】球員異動通知 (${todayStr})**\n> 今日尚無球員異動公告。\n🔗 [查看官網異動專區](https://www.cpbl.com.tw/player/trans)`;
    }

    if (DISCORD_ROSTER_WEBHOOK_URL) {
      await axios.post(DISCORD_ROSTER_WEBHOOK_URL, { content: output });
      console.log("✅ 異動通知已成功發送！");
    } else {
      console.error("❌ 未找到 DISCORD_ROSTER_WEBHOOK_URL 環境變數。");
    }
  } catch (error) {
    console.error("❌ 抓取球員異動失敗:", error);
  }
}

main();