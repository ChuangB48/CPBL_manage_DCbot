const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

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

// 帶有自動重試與代理備援的 HTML 抓取器
async function fetchCpblHtml() {
  const targetUrl = 'https://www.cpbl.com.tw/';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
  };

  // 1. 先嘗試直連
  try {
    console.log("🌐 嘗試直接連線 CPBL 官網...");
    const res = await axios.get(targetUrl, { headers, timeout: 8000 });
    if (res.data) return res.data;
  } catch (err) {
    console.log(`⚠️ 直連超時或失敗 (${err.message})，自動切換至加速節點通道...`);
  }

  // 2. 直連失敗時切換至代理通道 A (corsproxy)
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    const res = await axios.get(proxyUrl, { headers, timeout: 10000 });
    if (res.data) return res.data;
  } catch (err) {
    console.log(`⚠️ 代理通道 A 失敗，切換至備用通道 B...`);
  }

  // 3. 切換至備用通道 B (allorigins)
  const backupProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  const res = await axios.get(backupProxyUrl, { headers, timeout: 12000 });
  return res.data;
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`🔍 正在解析中華職棒賽事資料 [${todayStr}]...`);

  try {
    const html = await fetchCpblHtml();
    let games = [];

    // 1. 嘗試從 HTML 內部的 <script> 區塊提取 Vue/MVC 初始化的賽事 JSON
    const jsonMatches = html.match(/(?:GameADetail|Games|gamesData)\s*[:=]\s*(\[\{.*?\}\])/s) ||
                        html.match(/var\s+gameList\s*=\s*(\[\{.*?\}\])/s);

    if (jsonMatches && jsonMatches[1]) {
      try {
        games = JSON.parse(jsonMatches[1]);
        console.log(`✅ 成功提取結構化賽事資料 (${games.length} 場)！`);
      } catch (e) {
        console.log("⚠️ 內嵌 JSON 解析失敗，啟用 DOM 解析。");
      }
    }

    // 2. DOM 解析備援
    if (games.length === 0) {
      const $ = cheerio.load(html);

      $('.IndexScheduleList.major .game_item, .IndexSchedule .game_item, .IndexBlock .game_item').each((_, el) => {
        const item = $(el);
        const awayTeam = item.find('.team.away .team_name').text().trim();
        const homeTeam = item.find('.team.home .team_name').text().trim();
        const awayScore = item.find('.score .num.away').text().trim() || '-';
        const homeScore = item.find('.score .num.home').text().trim() || '-';
        const field = item.find('.place').first().text().trim() || '未定球場';
        const gameNo = item.find('.tag.game_no').text().trim();
        const statusTag = item.find('.tag.game_status').text().trim();

        const winPitcher = item.find('.PlayerMatchup.wins .player .name').text().trim();
        const losePitcher = item.find('.PlayerMatchup.loses .player .name').text().trim();
        const savePitcher = item.find('.PlayerMatchup.saves .player .name').text().trim();

        if (awayTeam && homeTeam) {
          games.push({
            VisitingTeamName: awayTeam,
            HomeTeamName: homeTeam,
            VisitingTotalScore: awayScore,
            HomeTotalScore: homeScore,
            FieldAbbe: field,
            GameSno: gameNo,
            StatusText: statusTag,
            WinPitcher: winPitcher,
            LosePitcher: losePitcher,
            SavePitcher: savePitcher
          });
        }
      });
    }

    // 3. 組合推播卡片
    let matchCards = [];

    games.forEach(game => {
      const away = game.VisitingTeamName || game.VisitingClubName || "客隊";
      const home = game.HomeTeamName || game.HomeClubName || "主隊";
      const awayScore = game.VisitingTotalScore ?? "-";
      const homeScore = game.HomeTotalScore ?? "-";
      const field = game.FieldAbbe || game.FieldName || "未定球場";
      const gameTag = game.GameSno ? `[${game.GameSno}]` : "";

      let status = "🕒 賽前預告 / 未開打";
      if (game.StatusText) {
        status = game.StatusText;
      } else if (game.GameStatus === 3 || (awayScore !== '-' && homeScore !== '-')) {
        status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
      } else if (game.GameStatus === 2) {
        status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
      }

      let extraInfo = "";
      if (game.WinPitcher) {
        extraInfo = `\n🏆 **勝投**：${game.WinPitcher} | **敗投**：${game.LosePitcher || '無'}`;
        if (game.SavePitcher) extraInfo += ` | **救援**：${game.SavePitcher}`;
      }

      matchCards.push(
        `⚾ **${away}**  vs  **${home}** ${gameTag}\n` +
        `🏟️ **球場**：${field}\n` +
        `📌 **狀態**：${status}${extraInfo}`
      );
    });

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 首頁未排定一軍賽程（可能為休兵日）。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事對戰列表 (${todayStr})**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播賽事資料到 Discord！");

  } catch (error) {
    console.error("❌ 執行過程發生錯誤:", error.message);
    process.exit(1);
  }
}

main();