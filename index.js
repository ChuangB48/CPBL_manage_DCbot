const axios = require('axios');

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

async function fetchOfficialCpblData(dateStr) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://www.cpbl.com.tw/box'
  };

  // 官方多重資料來源備援
  const candidateUrls = [
    `https://www.cpbl.com.tw/box/getgamelist?gameDate=${encodeURIComponent(dateStr)}&kindCode=A`,
    `https://www.cpbl.com.tw/home/getgamelist?GameDate=${encodeURIComponent(dateStr)}&KindCode=A`,
    `https://corsproxy.io/?${encodeURIComponent(`https://www.cpbl.com.tw/box/getgamelist?gameDate=${dateStr}&kindCode=A`)}`
  ];

  for (const url of candidateUrls) {
    try {
      console.log(`📡 正在嘗試請求官網數據端點: ${url}`);
      const res = await axios.get(url, { headers, timeout: 10000 });
      
      let list = [];
      if (Array.isArray(res.data)) list = res.data;
      else if (Array.isArray(res.data?.GameADetail)) list = res.data.GameADetail;
      else if (Array.isArray(res.data?.Games)) list = res.data.Games;
      else if (Array.isArray(res.data?.list)) list = res.data.list;

      if (list && list.length > 0) {
        return list;
      }
    } catch (e) {
      console.log(`端點請求異常: ${e.message}`);
    }
  }

  return [];
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`🔍 正在查詢中職官方即時賽況 [${todayStr}]...`);

  try {
    const games = await fetchOfficialCpblData(todayStr);
    let matchCards = [];

    if (games.length > 0) {
      games.forEach(game => {
        const away = game.VisitingTeamName || game.VisitingClubName || game.VisitingTeamCode || "客隊";
        const home = game.HomeTeamName || game.HomeClubName || game.HomeTeamCode || "主隊";
        const awayScore = (game.VisitingTotalScore !== undefined && game.VisitingTotalScore !== null && game.VisitingTotalScore !== '') ? game.VisitingTotalScore : "-";
        const homeScore = (game.HomeTotalScore !== undefined && game.HomeTotalScore !== null && game.HomeTotalScore !== '') ? game.HomeTotalScore : "-";
        const field = game.FieldAbbe || game.FieldName || "指定球場";
        const gameNo = game.GameSno ? `[第 ${game.GameSno} 場]` : "";

        // 賽事狀態判斷
        let status = "🕒 賽前預告 / 尚未開打";
        if (game.GameStatus === 3 || game.GameStatusText?.includes("結束") || (awayScore !== '-' && homeScore !== '-')) {
          status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 2 || game.GameStatusText?.includes("進行中")) {
          status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 4 || game.GameStatusText?.includes("延賽")) {
          status = "🌧️ 因雨延賽 / 取消";
        }

        // 投手資訊
        let pitcherInfo = "";
        if (game.WinningPitcherName) {
          pitcherInfo = `\n🏆 **勝投**：${game.WinningPitcherName} | **敗投**：${game.LosePitcherName || '無'}`;
        } else if (game.VisitingStartingPitcherName || game.HomeStartingPitcherName) {
          pitcherInfo = `\n🥊 **預告先發**：${game.VisitingStartingPitcherName || '未定'} (客) vs ${game.HomeStartingPitcherName || '未定'} (主)`;
        }

        matchCards.push(
          `⚾ **${away}** vs **${home}** ${gameNo}\n` +
          `🏟️ **球場**：${field}\n` +
          `📌 **狀態**：${status}${pitcherInfo}`
        );
      });
    }

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 中職官方未排定一軍賽事（可能為週一休兵日）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官方賽事實況看板 (${todayStr})**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播官網賽事實況到 Discord！");

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

main();