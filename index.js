const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) 的 YYYY/MM/DD
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
    console.log(`🔍 正在查詢台灣時間 [${todayStr}] 中職當日賽程與即時比分...`);

    // CPBL 官網賽事資料接口
    const response = await axios.get(`https://www.cpbl.com.tw/home/getgames?date=${todayStr}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.cpbl.com.tw/'
      },
      timeout: 15000
    });

    const games = Array.isArray(response.data) ? response.data : (response.data?.Games || response.data?.games || []);
    let matchLines = [];

    if (games && games.length > 0) {
      games.forEach(game => {
        // 解析客隊、主隊名稱
        const awayTeam = game.AwayTeamName || game.VisitingTeamName || game.VisitingClubName || game.GuestTeamName || "客隊";
        const homeTeam = game.HomeTeamName || game.HomeClubName || "主隊";

        // 分數
        const awayScore = game.VisitingScore ?? game.AwayScore ?? "-";
        const homeScore = game.HomeScore ?? "-";

        // 球場與狀態
        const field = game.Field || game.FieldName || "";
        const gameNo = game.GameNo || game.GameSno ? `(G${game.GameNo || game.GameSno})` : "";
        let statusText = game.GameStatusText || game.Status || "賽前 / 未開打";

        let statusEmoji = "🟢";
        if (statusText.includes("結束") || statusText.includes("終場") || statusText.includes("FINAL")) {
          statusEmoji = "🔴";
          statusText = "比賽結束";
        } else if (statusText.includes("延") || statusText.includes("取消") || statusText.includes("因雨")) {
          statusEmoji = "🌧️";
        }

        matchLines.push(
          `⚾ **${awayTeam}**  **${awayScore}** : **${homeScore}**  **${homeTeam}** ${gameNo}\n` +
          `🏟️ **球場**：${field || "未定"}\n` +
          `📌 **狀態**：${statusEmoji} ${statusText}`
        );
      });
    }

    let finalMessage = "";
    if (matchLines.length > 0) {
      finalMessage = matchLines.join('\n\n───────────────\n\n');
    } else {
      finalMessage = `ℹ️ 今日 (${todayStr}) 中華職棒無排定賽事，或今日賽程尚未開始。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事與即時比分 (${todayStr})**\n\n${finalMessage}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播精準賽事到 Discord！");

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