const axios = require('axios');

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

async function fetchCpblGames(dateStr) {
  const endpoints = [
    {
      url: 'https://www.cpbl.com.tw/home/getgamelist',
      data: { GameDate: dateStr, KindCode: 'A' }
    },
    {
      url: 'https://www.cpbl.com.tw/box/getgamelist',
      data: { gameDate: dateStr, kindCode: 'A' }
    },
    {
      url: 'https://www.cpbl.com.tw/home/getgames',
      data: { date: dateStr, kindCode: 'A' }
    }
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://www.cpbl.com.tw/'
  };

  for (const ep of endpoints) {
    try {
      console.log(`📡 嘗試請求官方賽事介面: ${ep.url}...`);
      const res = await axios.post(ep.url, new URLSearchParams(ep.data).toString(), {
        headers,
        timeout: 10000
      });

      let list = null;
      if (Array.isArray(res.data)) list = res.data;
      else if (Array.isArray(res.data?.GameADetail)) list = res.data.GameADetail;
      else if (Array.isArray(res.data?.Games)) list = res.data.Games;
      else if (Array.isArray(res.data?.list)) list = res.data.list;

      if (list && list.length > 0) {
        return list;
      }
    } catch (err) {
      console.log(`⚠️ 端點 ${ep.url} 回應異常: ${err.message}`);
    }
  }

  // 若 POST 被檔，使用首頁 HTML 正則與備援接口
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent('https://www.cpbl.com.tw/')}`;
    const htmlRes = await axios.get(proxyUrl, { timeout: 10000 });
    const html = htmlRes.data;

    const matched = html.match(/(?:GameADetail|Games)\s*[:=]\s*(\[\{.*?\}\])/s);
    if (matched && matched[1]) {
      return JSON.parse(matched[1]);
    }
  } catch (e) {
    console.log("備用解析未取得更多資料");
  }

  return [];
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  const { slashDate } = getTaiwanDate();
  console.log(`🔍 正在查詢中職官方賽程與對戰清單 [${slashDate}]...`);

  try {
    const games = await fetchCpblGames(slashDate);
    let matchCards = [];

    if (games && games.length > 0) {
      games.forEach(game => {
        const away = game.VisitingTeamName || game.VisitingClubName || game.VisitingTeamCode || "客隊";
        const home = game.HomeTeamName || game.HomeClubName || game.HomeTeamCode || "主隊";
        const awayScore = game.VisitingTotalScore ?? "-";
        const homeScore = game.HomeTotalScore ?? "-";
        const field = game.FieldAbbe || game.FieldName || "未定球場";
        const gameNo = game.GameSno ? `[第 ${game.GameSno} 場]` : "";

        // 狀態判斷
        let status = "🕒 賽前預告 / 未開打";
        if (game.GameStatus === 3 || game.GameStatusText?.includes("結束")) {
          status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 2 || game.GameStatusText?.includes("進行中")) {
          status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 4 || game.GameStatusText?.includes("延賽")) {
          status = "🌧️ 因雨延賽 / 取消";
        }

        // 投手資訊（先發 / 勝敗投）
        let extra = "";
        if (game.WinningPitcherName) {
          extra = `\n🏆 **勝投**：${game.WinningPitcherName} | **敗投**：${game.LosePitcherName || '無'}`;
        } else if (game.VisitingStartingPitcherName || game.HomeStartingPitcherName) {
          extra = `\n🥊 **先發投手**：${game.VisitingStartingPitcherName || '未定'} (客) vs ${game.HomeStartingPitcherName || '未定'} (主)`;
        }

        matchCards.push(
          `⚾ **${away}** vs **${home}** ${gameNo}\n` +
          `🏟️ **球場**：${field}\n` +
          `📌 **狀態**：${status}${extra}`
        );
      });
    }

    let messageContent = "";
    if (matchCards.length > 0) {
      messageContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 今日 (${slashDate}) 中職官方無排定之一軍賽事（可能為週一休兵日或賽程已結束）。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事實況看板 (${slashDate})**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播對戰資訊到 Discord！");

  } catch (error) {
    console.error("❌ 執行過程發生錯誤:", error.message);
    process.exit(1);
  }
}

main();