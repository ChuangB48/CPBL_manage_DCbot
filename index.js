const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) 指定位移天數的日期字串
function getTaiwanDate(offsetDays = 0) {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const target = new Date(utc + (3600000 * 8) + (offsetDays * 86400000));

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');

  return `${yyyy}/${mm}/${dd}`;
}

// 隊伍 ID 對照表
const TEAM_NAMES = {
  "1": "中信兄弟",
  "2": "統一7-ELEVEn獅",
  "3": "富邦悍將",
  "4": "味全龍",
  "5": "樂天桃猿",
  "6": "台鋼雄鷹",
  "A": "中信兄弟",
  "B": "統一7-ELEVEn獅",
  "E": "富邦悍將",
  "L": "味全龍",
  "AJL": "樂天桃猿",
  "TSG": "台鋼雄鷹"
};

async function fetchOfficialSchedule(dateStr) {
  try {
    const url = `https://corsproxy.io/?url=${encodeURIComponent(`https://www.cpbl.com.tw/home/getgamelist?GameDate=${dateStr}&KindCode=A`)}`;
    const res = await axios.get(url, { timeout: 8000 });
    
    let list = [];
    if (Array.isArray(res.data?.GameADetail)) list = res.data.GameADetail;
    else if (Array.isArray(res.data?.Games)) list = res.data.Games;
    else if (Array.isArray(res.data)) list = res.data;

    return list;
  } catch (err) {
    return [];
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate(0);
  console.log(`🔍 正在查詢中職賽事看板 [${todayStr}]...`);

  try {
    let todayGames = await fetchOfficialSchedule(todayStr);
    let targetDateStr = todayStr;
    let isFutureMatch = false;

    // 如果今日無賽事，自動往後找未來 7 天內的最近比賽日
    if (todayGames.length === 0) {
      console.log("今日無賽事，正在搜尋近期下一場賽程...");
      for (let i = 1; i <= 7; i++) {
        const nextDate = getTaiwanDate(i);
        const nextGames = await fetchOfficialSchedule(nextDate);
        if (nextGames.length > 0) {
          todayGames = nextGames;
          targetDateStr = nextDate;
          isFutureMatch = true;
          break;
        }
      }
    }

    let matchCards = [];
    if (todayGames.length > 0) {
      todayGames.forEach(game => {
        const away = game.VisitingTeamName || TEAM_NAMES[game.VisitingTeamCode] || "客隊";
        const home = game.HomeTeamName || TEAM_NAMES[game.HomeTeamCode] || "主隊";
        const awayScore = game.VisitingTotalScore ?? "-";
        const homeScore = game.HomeTotalScore ?? "-";
        const venue = game.FieldAbbe || game.FieldName || "官方球場";
        const gameNo = game.GameSno ? `[編號第 ${game.GameSno} 場]` : "";

        let statusText = "🕒 賽前預告 / 尚未開打";
        if (game.GameStatus === 3 || (awayScore !== '-' && homeScore !== '-')) {
          statusText = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 2) {
          statusText = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
        }

        matchCards.push(
          `⚾ **${away}** vs **${home}** ${gameNo}\n` +
          `🏟️ **球場**：${venue}\n` +
          `📌 **狀態**：${statusText}`
        );
      });
    }

    let finalContent = "";
    if (matchCards.length > 0) {
      const headerPrefix = isFutureMatch 
        ? `ℹ️ **今日 (${todayStr}) 為休兵日，為您帶來最近賽程預告 (${targetDateStr})：**\n\n`
        : "";
      finalContent = headerPrefix + matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 及本週近期皆無賽事排程（全明星週或非賽季期間）。`;
    }

    const payload = {
      content: `📢 **中華職棒 賽事實況看板**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播賽事資訊至 Discord！");

  } catch (error) {
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();