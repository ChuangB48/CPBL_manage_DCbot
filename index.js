const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY/MM/DD 與 YYYY-MM-DD
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return {
    slashDate: `${yyyy}/${mm}/${dd}`,
    dashDate: `${yyyy}-${mm}-${dd}`
  };
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  const { slashDate, dashDate } = getTaiwanDate();
  console.log(`🔍 正在取得台灣時間 [${slashDate}] 中華職棒賽事資料...`);

  let games = [];

  // 嘗試 1：直接呼叫 CPBL 首頁 Vue 所使用的賽事 API
  try {
    const apiRes = await axios.post(
      'https://www.cpbl.com.tw/home/getgames',
      new URLSearchParams({
        date: slashDate,
        KindCode: 'A' // A 代表一軍賽事
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.cpbl.com.tw/'
        },
        timeout: 10000
      }
    );

    const data = apiRes.data;
    if (Array.isArray(data)) {
      games = data;
    } else if (data && Array.isArray(data.GameADetail)) {
      games = data.GameADetail;
    } else if (data && Array.isArray(data.Games)) {
      games = data.Games;
    }
  } catch (err) {
    console.log("ℹ️ API POST 請求未能取得資料，嘗試 GET 請求...");
    try {
      const getRes = await axios.get(`https://www.cpbl.com.tw/home/getgames?date=${encodeURIComponent(slashDate)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.cpbl.com.tw/'
        },
        timeout: 10000
      });
      if (Array.isArray(getRes.data)) games = getRes.data;
      else if (getRes.data?.GameADetail) games = getRes.data.GameADetail;
    } catch (e) {
      console.log("⚠️ API 介面暫無法使用，切換為備用解析。");
    }
  }

  let matchCards = [];

  if (games && games.length > 0) {
    games.forEach(game => {
      const awayTeam = game.VisitingTeamName || game.VisitingClubName || "客隊";
      const homeTeam = game.HomeTeamName || game.HomeClubName || "主隊";
      const awayScore = game.VisitingTotalScore ?? "-";
      const homeScore = game.HomeTotalScore ?? "-";
      const field = game.FieldAbbe || game.FieldName || "未定球場";
      const gameNo = game.GameSno ? `(第 ${game.GameSno} 場)` : "";

      // 狀態判斷 (GameStatus: 1=未開打, 2=進行中, 3=結束, 4=延賽/取消)
      let statusText = "🕒 賽前預告 / 未開打";
      if (game.GameStatus === 3 || game.GameStatusText?.includes("結束")) {
        statusText = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
      } else if (game.GameStatus === 2 || game.GameStatusText?.includes("進行中")) {
        statusText = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
      } else if (game.GameStatus === 4 || game.GameStatusText?.includes("延賽")) {
        statusText = "🌧️ 因雨延賽 / 取消";
      }

      // 先發投手或勝敗投
      let pitcherInfo = "";
      if (game.WinningPitcherName) {
        pitcherInfo = `\n🏆 **勝投**：${game.WinningPitcherName} | **敗投**：${game.LosePitcherName || '無'}`;
      } else if (game.VisitingStartingPitcherName || game.HomeStartingPitcherName) {
        pitcherInfo = `\n🥊 **預告先發**：${game.VisitingStartingPitcherName || '未定'} vs ${game.HomeStartingPitcherName || '未定'}`;
      }

      matchCards.push(
        `⚾ **${awayTeam}**  vs  **${homeTeam}** ${gameNo}\n` +
        `🏟️ **球場**：${field}\n` +
        `📌 **狀態**：${statusText}${pitcherInfo}`
      );
    });
  }

  let finalContent = "";
  if (matchCards.length > 0) {
    finalContent = matchCards.join('\n\n───────────────\n\n');
  } else {
    finalContent = `ℹ️ 今日 (${slashDate}) 中職官方未排定一軍賽程（今日無比賽）。`;
  }

  const payload = {
    content: `📢 **中華職棒 今日賽事實況看板 (${slashDate})**\n\n${finalContent}`
  };

  try {
    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播今日真實賽程至 Discord！");
  } catch (err) {
    console.error("❌ 發送到 Discord 失敗:", err.message);
    process.exit(1);
  }
}

main();