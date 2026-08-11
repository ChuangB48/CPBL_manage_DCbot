const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

// 取得台灣時間 YYYY-MM-DD
function getTaiwanDateString() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));
  
  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    const todayStr = getTaiwanDateString();
    console.log(`🔍 正在從 CPBL 官網首頁頂部 (https://www.cpbl.com.tw/) 解析最新賽程與即時比分...`);

    // 請求首頁
    const response = await axios.get('https://www.cpbl.com.tw/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
        'Cache-Control': 'no-cache'
      },
      timeout: 20000
    });

    const $ = cheerio.load(response.data);

    // 1. 先把底層新聞、側欄排行榜、頁尾、跑馬燈直接剔除
    $('footer, marquee, .marquee, .news, .news-list, .rank, .rank-list, .leaderboard, .sidebar, .standing').remove();

    const matches = [];

    // 2. 針對頂部輪播/看板區塊進行比對
    // CPBL 頂部賽事結構主要分布於 header, .header-game-list, .top-score 等區塊中
    $('header, .header, .top-scoreboard, .game-box, .game_box, .swiper-slide, body div').each((_, el) => {
      // 避免父層大容器重複抓取
      if ($(el).children().length > 6) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();

      // 過濾排行榜與新聞關鍵字
      if (/(盜壘|勝投|安打|防禦率|打擊率|先發|全壘打|補賽周|補賽週|影音|特輯)/.test(rawText)) {
        return;
      }

      // 檢查是否包含兩支對決球隊
      const foundTeams = CPBL_TEAMS.filter(t => rawText.includes(t));

      if (foundTeams.length === 2 && rawText.length >= 6 && rawText.length <= 80) {
        const key = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === key || m.key === reverseKey)) {
          // 狀態判定
          let statusEmoji = "🕒";
          let statusText = "賽前預告 / 未開打";

          if (rawText.includes("結束") || rawText.includes("終場") || rawText.includes("Final")) {
            statusEmoji = "🔴";
            statusText = "比賽結束";
          } else if (rawText.includes("延賽") || rawText.includes("取消") || rawText.includes("因雨")) {
            statusEmoji = "🌧️";
            statusText = "因雨延賽";
          } else if (rawText.includes("LIVE") || rawText.includes("局") || /\d+\s*[-:比]\s*\d+/.test(rawText)) {
            statusEmoji = "🟢";
            statusText = "比賽進行中";
          }

          matches.push({
            key,
            awayTeam: foundTeams[0],
            homeTeam: foundTeams[1],
            info: rawText,
            status: `${statusEmoji} ${statusText}`
          });
        }
      }
    });

    let messageContent = "";
    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.awayTeam}** vs **${m.homeTeam}**\n📋 **賽程看板**：${m.info}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 首頁看板目前無即時賽程或排定對戰（可能今日無賽事或賽程尚未更新）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官方最新賽事 / 即時看板**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播 CPBL 首頁賽事到 Discord！");

  } catch (error) {
    if (error.response) {
      console.error(`❌ 發送失敗，狀態碼: ${error.response.status}`);
      console.error("📋 回傳錯誤詳情:", typeof error.response.data === 'string' ? error.response.data.slice(0, 300) : error.response.data);
    } else {
      console.error("❌ 執行過程發生錯誤:", error.message);
    }
    process.exit(1);
  }
}

main();