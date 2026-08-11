const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 中職官網 (CPBL) 抓取當日比分與戰況...");

    // 抓取 CPBL 官網賽程比分頁
    const response = await axios.get('https://www.cpbl.com.tw/schedule', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // CPBL 官網今日賽事通常在 .game_item 或賽程表格區塊內
    // 遍歷所有賽事節點
    $('.game_item, .schedule_item, tr, div[class*="game"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      
      const teams = ["中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹"];
      const foundTeams = teams.filter(team => text.includes(team));

      // 剛好對決兩隊
      if (foundTeams.length === 2 && text.length < 200 && text.length > 10) {
        const matchKey = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === matchKey || m.key === reverseKey)) {
          let statusBadge = "🟢 進行中 / 賽前";
          if (text.includes("結束") || text.includes("終場") || text.includes("Final") || text.includes("比賽結束")) {
            statusBadge = "🔴 比賽結束";
          } else if (text.includes("延賽") || text.includes("取消") || text.includes("因雨")) {
            statusBadge = "🌧️ 延賽 / 取消";
          }

          matches.push({
            key: matchKey,
            teamAway: foundTeams[0],
            teamHome: foundTeams[1],
            detail: text,
            status: statusBadge
          });
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.teamAway}** vs **${m.teamHome}**\n📊 **賽況與比分**：${m.detail}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = "ℹ️ 今日無排定之中華職棒賽事，或賽事尚未開始。";
    }

    const payload = {
      content: `📢 **中華職棒 今日戰況 / 最終比分**\n\n${messageContent.slice(0, 1800)}`
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