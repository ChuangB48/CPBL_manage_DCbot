const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 CPBL 首頁取得最新比分與戰況...");

    // 抓取 CPBL 首頁（保證 200 回傳，包含即時賽況板塊）
    const response = await axios.get('https://www.cpbl.com.tw/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // 解析頁面內所有可能包含比賽卡片的容器
    $('div, li, tr, a').each((_, el) => {
      // 避免太深或太龐大的外層容器
      if ($(el).children().length > 12) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();
      const foundTeams = CPBL_TEAMS.filter(team => rawText.includes(team));

      // 剛好抓到對戰的兩隊
      if (foundTeams.length === 2 && rawText.length >= 10 && rawText.length <= 150) {
        const key = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === key || m.key === reverseKey)) {
          let statusBadge = "🟢 進行中 / 賽前";
          if (rawText.includes("結束") || rawText.includes("終場") || rawText.includes("Final")) {
            statusBadge = "🔴 比賽結束";
          } else if (rawText.includes("延賽") || rawText.includes("取消") || rawText.includes("因雨")) {
            statusBadge = "🌧️ 延賽 / 取消";
          }

          matches.push({
            key,
            teamAway: foundTeams[0],
            teamHome: foundTeams[1],
            detail: rawText,
            status: statusBadge
          });
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.teamAway}** vs **${m.teamHome}**\n📊 **賽況**：${m.detail}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = "ℹ️ 今日無排定之中華職棒賽事，或賽事尚未開始。";
    }

    const payload = {
      content: `📢 **中華職棒 最新賽事戰況 / 即時比分**\n\n${messageContent.slice(0, 1800)}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播當日賽事戰況到 Discord！");

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