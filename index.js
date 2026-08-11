const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 Yahoo API 取得中職即時比分...");

    // Yahoo 運動公開賽事 API (CPBL 專用代碼)
    const apiUrl = 'https://tw.sports.yahoo.com/_td-sports/api/resource/ScoreboardService.getScoreboard;league=cpbl;tz=Asia%2FTaipei';
    
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 15000
    });

    const gamesData = response.data?.games || response.data?.scoreboard?.games || [];
    let matchLines = [];

    // 如果 API 有回傳今日賽事陣列
    if (Array.isArray(gamesData) && gamesData.length > 0) {
      gamesData.forEach(game => {
        const awayTeam = game.awayTeam?.name || game.teams?.away?.name || "客隊";
        const homeTeam = game.homeTeam?.name || game.teams?.home?.name || "主隊";
        const awayScore = game.awayTeam?.score ?? game.teams?.away?.score ?? "-";
        const homeScore = game.homeTeam?.score ?? game.teams?.home?.score ?? "-";
        
        // 狀態解析 (例如：比賽結束、7局下、延賽)
        let statusText = game.status?.display || game.statusDescription || "進行中";
        if (game.status?.type === "FINAL" || statusText.includes("結束")) {
          statusText = "🔴 比賽結束";
        } else if (game.status?.type === "IN_PROGRESS") {
          statusText = `🟢 ${statusText}`;
        }

        matchLines.push(`⚾ **${awayTeam}** ${awayScore} : ${homeScore} **${homeTeam}**\n📌 **狀態**：${statusText}`);
      });
    }

    // 備援解析：如果 JSON 結構不同，解析純字串
    if (matchLines.length === 0) {
      const rawText = JSON.stringify(response.data);
      const teams = ["中信兄弟", "統一獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹"];
      // 搜尋是否有相關球隊
      if (teams.some(t => rawText.includes(t))) {
        matchLines.push("⚾ 今日中職賽事進行中，請鎖定轉播！");
      }
    }

    let finalMessage = "";
    if (matchLines.length > 0) {
      finalMessage = matchLines.join('\n\n───────────────\n\n');
    } else {
      finalMessage = "ℹ️ 今日無排定之中華職棒賽事。";
    }

    const payload = {
      content: `📢 **中華職棒 今日即時戰況 / 最終比分**\n\n${finalMessage}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播最新戰況到 Discord！");

  } catch (error) {
    if (error.response) {
      console.error(`❌ 發送失敗，狀態碼: ${error.response.status}`);
      console.error("📋 回傳錯誤詳情:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("❌ 執行過程發生錯誤:", error.message);
    }
    process.exit(1);
  }
}

main();