const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一獅", "統一7-ELEVEn獅", "味全龍", 
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 Yahoo 中職賽程頁面解析比分與戰況...");

    const response = await axios.get('https://tw.sports.yahoo.com/cpbl/schedule/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // Yahoo 賽程列表中每一場比賽的外層容器
    $('li, tr, div[class*="game"], div[class*="item"], div[class*="row"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      // 找出該區塊中出現的球隊
      const foundTeams = CPBL_TEAMS.filter(team => text.includes(team));
      
      // 確保剛好抓到對戰的兩隊，且排除過長的外層父容器
      if (foundTeams.length === 2 && text.length < 150) {
        // 避免重複加入
        const matchKey = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;
        
        if (!matches.some(m => m.key === matchKey || m.key === reverseKey)) {
          // 判斷賽事狀態
          let statusBadge = "🟢 進行中 / 賽前";
          if (text.includes("結束") || text.includes("Final") || text.includes("終場")) {
            statusBadge = "🔴 比賽結束";
          } else if (text.includes("延賽") || text.includes("取消")) {
            statusBadge = "🌧️ 延賽 / 取消";
          }

          matches.push({
            key: matchKey,
            team1: foundTeams[0],
            team2: foundTeams[1],
            detail: text,
            status: statusBadge
          });
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.team1}** vs **${m.team2}**\n📊 **賽況**：${m.detail}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      // 兜底方案：直接從全頁文字中搜尋球隊對戰關鍵字
      const fullBodyText = $('body').text().replace(/\s+/g, ' ');
      const activeTeams = CPBL_TEAMS.filter(team => fullBodyText.includes(team));
      
      if (activeTeams.length >= 2) {
        messageContent = `⚾ 今日排定有賽事出賽球隊：${[...new Set(activeTeams)].join('、')}\n（詳情請參閱轉播或賽程表）`;
      } else {
        messageContent = "ℹ️ 今日無排定之中華職棒賽事。";
      }
    }

    const payload = {
      content: `📢 **中華職棒 當日戰況 / 賽事比分**\n\n${messageContent.slice(0, 1800)}`
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