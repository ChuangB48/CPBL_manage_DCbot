const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY/MM/DD
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return {
    slash: `${yyyy}/${mm}/${dd}`,
    short: `${parseInt(mm)}/${parseInt(dd)}`
  };
}

async function fetchCpblGames() {
  const dateInfo = getTaiwanDate();
  console.log(`🌐 正在透過體育即時資料源查詢 [${dateInfo.slash}] 賽事...`);

  // 1. 優先爬取 LINE TODAY 中職專區（絕不擋海外 IP）
  try {
    const res = await axios.get('https://today.line.me/tw/v2/page/cpbl', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      },
      timeout: 10000
    });

    const $ = cheerio.load(res.data);
    let games = [];

    // 尋找中職球隊關鍵字與比分節點
    const teamKeywords = ["中信兄弟", "統一獅", "統一7-ELEVEn獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹", "兄弟", "獅", "龍", "悍將", "桃猿", "雄鷹"];

    $('div, section, a').each((_, el) => {
      const text = $(el).text();
      // 確保不是大範圍父層容器
      if ($(el).children().length > 10) return;

      const matchedTeams = teamKeywords.filter(t => text.includes(t));
      if (matchedTeams.length >= 2 && (text.includes('VS') || text.includes('vs') || text.includes(':') || text.includes('18:') || text.includes('17:'))) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        games.push({
          teams: `${matchedTeams[0]} vs ${matchedTeams[1]}`,
          info: lines.join(' ')
        });
      }
    });

    if (games.length > 0) {
      // 去除重複對戰組合
      const unique = [];
      const seen = new Set();
      for (const g of games) {
        if (!seen.has(g.teams)) {
          seen.add(g.teams);
          unique.push(g);
        }
      }
      return unique;
    }
  } catch (err) {
    console.error(`⚠️ LINE TODAY 查詢失敗: ${err.message}`);
  }

  // 2. 備援方案：CPBL 官方開放賽程端點
  try {
    const res = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.cpbl.com.tw/home/getgamelist')}`, {
      timeout: 12000
    });
    const list = res.data?.GameADetail || res.data?.Games || (Array.isArray(res.data) ? res.data : []);
    if (list.length > 0) {
      return list.map(g => ({
        teams: `${g.VisitingTeamName || '客隊'} vs ${g.HomeTeamName || '主隊'}`,
        info: `比分: ${g.VisitingTotalScore ?? '-'} : ${g.HomeTotalScore ?? '-'} | 球場: ${g.FieldAbbe || '現場'} | 狀態: ${g.GameStatus === 3 ? '比賽結束' : '賽事進行中/預告'}`
      }));
    }
  } catch (err) {
    console.error(`⚠️ CPBL 備援通道失敗: ${err.message}`);
  }

  return [];
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const { slash: todayStr } = getTaiwanDate();

  try {
    const games = await fetchCpblGames();
    let matchCards = [];

    if (games.length > 0) {
      games.forEach(g => {
        matchCards.push(
          `⚾ **${g.teams}**\n` +
          `📝 **賽事實況**：${g.info}`
        );
      });
    }

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 無一軍賽事資料（可能為休兵日或尚未開賽）。`;
    }

    const payload = {
      content: `📢 **中華職棒 賽事實況看板 (${todayStr})**\n\n${finalContent}`
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