const axios = require('axios');
const cheerio = require('cheerio');

async function getCPBLScores() {
    try {
        // 1. 抓取中職官網首頁或賽程頁面 HTML
        const response = await axios.get('https://www.cpbl.com.tw', {
            headers: {
                // 模擬正常瀏覽器請求，避免被擋
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // 2. 用 cheerio 載入 HTML
        const $ = cheerio.load(response.data);
        const games = [];

        // 3. 根據網頁上的 class 選取器抓取比分區塊 (以官網比分卡片為例)
        $('.game_box, .item').each((index, element) => {
            const awayTeam = $(element).find('.team_away, .away').text().trim();
            const homeTeam = $(element).find('.team_home, .home').text().trim();
            const score = $(element).find('.score').text().trim();
            const status = $(element).find('.status, .inning').text().trim();

            if (awayTeam && homeTeam) {
                games.push({
                    matchup: `${awayTeam} vs ${homeTeam}`,
                    score: score || "未開打/無比分",
                    status: status
                });
            }
        });

        console.log("今日中職戰況：", games);
        return games;

    } catch (error) {
        console.error("抓取中職官網失敗:", error.message);
    }
}

getCPBLScores();