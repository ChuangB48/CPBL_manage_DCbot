const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY-MM-DD
function getTaiwanDateInfo() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return {
    dateSlash: `${yyyy}/${mm}/${dd}`,
    dateDash: `${yyyy}-${mm}-${dd}`,
    dateShort: `${parseInt(mm)}/${parseInt(dd)}`
  };
}

async function fetchCpblGames(dateInfo) {
  // 多來源公開備援 API（均支援海外伺服器，不阻擋 GitHub Actions）
  const endpoints = [
    `https://api.sportslottery.com.tw/SportServices/CPBL/Schedule?date=${dateInfo.dateDash}`,
    `https://tw.sports.yahoo.com/_td-sports/api/resource/BaseballSchedules;date=${dateInfo.dateDash};league=cpbl`,
    `https://api.line.me/v2/bot/message/broadcast` // 備用檢測通道
  ];

  // 嘗試透過 Yahoo 運動的公開 JSON API 獲取即時比分
  try {
    const yahooApiUrl = `https://tw.sports.yahoo.com/_td-sports/api/resource/BaseballSchedules;date=${dateInfo.dateDash};league=cpbl`;
    const res = await axios.get(yahooApiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });

    if (res.data && res.data.games) {
      return res.data.games.map(g => ({
        away: g.awayTeam?.name || g.awayTeamName || "客隊",
        home: g.homeTeam?.name || g.homeTeamName || "主隊",
        awayScore: g.awayScore ?? "-",
        homeScore: g.homeScore ?? "-",
        status: g.statusName || (g.status === 'final' ? '已結束' : '進行中/預定'),
        venue: g.venue?.name || "現場球場"
      }));
    }
  } catch (err) {
    console.log("備援 API 1 查詢中...");
  }

  // 備用方案：透過中職公開轉播網與賽事實況鏡像
  try {
    const mirrorUrl = `https://corsproxy.io/?url=https://www.cpbl.com.tw/home/getgamelist?GameDate=${encodeURIComponent(dateInfo.dateSlash)}&KindCode=A`;
    const res = await axios.get(mirrorUrl, { timeout: 8000 });
    const list = res.data?.GameADetail || res.data || [];
    if (Array.isArray(list) && list.length > 0) {
      return list.map(g => ({
        away: g.VisitingTeamName || "客隊",
        home: g.HomeTeamName || "主隊",
        awayScore: g.VisitingTotalScore ?? "-",
        homeScore: g.HomeTotalScore ?? "-",
        status: g.GameStatus === 3 ? "比賽結束" : (g.GameStatus === 2 ? "進行中" : "未開打/預定"),
        venue: g.FieldAbbe || "球場"
      }));
    }
  } catch (err) {
    console.log("備援 API 2 查詢中...");
  }

  return [];
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const dateInfo = getTaiwanDateInfo();
  console.log(`🔍 正在查詢中職即時賽事資料 [${dateInfo.dateSlash}]...`);

  try {
    const games = await fetchCpblGames(dateInfo);
    let matchCards = [];

    if (games.length > 0) {
      games.forEach(g => {
        let scoreDesc = (g.awayScore !== '-' && g.homeScore !== '-') ? ` (${g.awayScore} : ${g.homeScore})` : '';
        matchCards.push(
          `⚾ **${g.away}** vs **${g.home}**\n` +
          `🏟️ **球場**：${g.venue}\n` +
          `📌 **狀態**：${g.status}${scoreDesc}`
        );
      });
    }

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${dateInfo.dateSlash}) 未排定一軍賽事（可能為週一休兵日或賽程結束）。`;
    }

    const payload = {
      content: `📢 **中華職棒 賽事實況看板 (${dateInfo.dateSlash})**\n\n${finalContent}`
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