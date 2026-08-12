const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY/MM/DD
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return `${yyyy}/${mm}/${dd}`;
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`🔍 正在抓取今日中華職棒即時賽事實況 [${todayStr}]...`);

  try {
    // 爬取 Yahoo 運動 CPBL 即時賽程中心（完全不擋海外 IP）
    const response = await axios.get('https://tw.sports.yahoo.com/baseball/cpbl/schedule/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    let matchCards = [];

    // 解析 Yahoo CPBL 賽程卡片
    $('li.Py\\(12px\\), .Mb\\(12px\\), [data-test="schedule-item"]').each((_, el) => {
      const item = $(el);
      const text = item.text();

      // 檢查是否包含中職球隊關鍵字
      const teams = ["中信兄弟", "統一獅", "統一7-ELEVEn獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹"];
      const matched = teams.filter(t => text.includes(t));

      if (matched.length >= 2) {
        const awayTeam = matched[0];
        const homeTeam = matched[1];
        
        // 抓取比分或開賽時間
        const scoreNumbers = text.match(/\d+/g) || [];
        const isFinished = text.includes('結束') || text.includes('終');
        const isLive = text.includes('上') || text.includes('下') || text.includes('進行中');

        let statusDesc = "🕒 賽前預告 / 準備開打";
        if (isFinished) {
          statusDesc = `🔴 比賽結束`;
        } else if (isLive) {
          statusDesc = `🟢 比賽進行中`;
        }

        matchCards.push(
          `⚾ **${awayTeam}**  vs  **${homeTeam}**\n` +
          `📌 **狀態**：${statusDesc}`
        );
      }
    });

    // 去除重複對戰組合
    matchCards = [...new Set(matchCards)];

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 無排定之一軍賽事（可能為週一休兵日）。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事實況看板 (${todayStr})**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播賽事資訊到 Discord！");

  } catch (error) {
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();