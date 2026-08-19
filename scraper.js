// scraper.js
const puppeteer = require('puppeteer');

async function fetchCPBLData() {
  const targetUrl = 'https://stats.cpbl.com.tw/';
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  
  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    const matchesData = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const candidateDivs = allDivs.filter(div => {
        const text = div.innerText.trim();
        const gameMatches = text.match(/GAME\d+/gi) || [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        return gameMatches.length === 1 && lines.length >= 3 && lines.length <= 25;
      });

      candidateDivs.sort((a, b) => a.innerText.length - b.innerText.length);
      const seen = new Set();
      const results = [];

      for (const card of candidateDivs) {
        const text = card.innerText.trim();
        const gameIdMatch = text.match(/GAME\d+/gi);
        if (!gameIdMatch) continue;
        const gameId = gameIdMatch[0].toUpperCase();

        if (seen.has(gameId)) continue;
        seen.add(gameId);

        const anchor = card.querySelector('a') || card.closest('a');
        const boxUrl = anchor ? anchor.href : '';

        results.push({
          gameId,
          rawText: text,
          boxUrl,
          status: text.includes('進行中') ? '進行中' : '其他'
        });
      }
      return results;
    });

    // 抓取進行中賽事的投打詳細資料
    for (let match of matchesData) {
      if (match.status === '進行中' && match.boxUrl) {
        let detailPage = null;
        try {
          detailPage = await browser.newPage();
          await detailPage.emulateTimezone('Asia/Taipei');
          await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36');
          await detailPage.goto(match.boxUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await new Promise(r => setTimeout(r, 3000));

          const detailData = await detailPage.evaluate(() => {
            const fullText = document.body.innerText;
            let inning = '';
            const inningMatch = fullText.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*局?\s*([上下])/);
            if (inningMatch) inning = `${inningMatch[1]}局${inningMatch[2]}`;

            const invalidNames = ['局數','打席','打數','安打','得分','打點','三振','四壞','四死','失分','自責分','投球數','防禦率','先發','替補','成績','紀錄','投手','打者','守備','代打','代跑','勝投','敗投','救援','出局'];

            let pitcher = '';
            const pMatches = Array.from(fullText.matchAll(/(?:投手|投\s*手|P)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g));
            for (const m of pMatches) {
              const candidate = m[1].trim();
              if (!invalidNames.some(inv => candidate.includes(inv))) { pitcher = candidate; break; }
            }

            let batter = '';
            const bMatches = Array.from(fullText.matchAll(/(?:打者|打\s*者|B)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g));
            for (const m of bMatches) {
              const candidate = m[1].trim();
              if (!invalidNames.some(inv => candidate.includes(inv))) { batter = candidate; break; }
            }

            return { inning, pitcher, batter };
          });

          match.inning = detailData.inning;
          match.pitcher = detailData.pitcher;
          match.batter = detailData.batter;
        } catch (e) {
          console.error(`無法取得 ${match.gameId} 詳細資料:`, e.message);
        } finally {
          if (detailPage) await detailPage.close();
        }
      }
    }

    await browser.close();
    return matchesData;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
// 在 scraper.js 中新增這個函數
// scraper.js 中的 fetchRosterMovements 替換為以下內容
async function fetchRosterMovements() {
  const targetUrl = 'https://www.cpbl.com.tw/player/trans';
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });

  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    // 等待 4 秒讓動態表格徹底載入
    await new Promise(r => setTimeout(r, 4000));

    const records = await page.evaluate(() => {
      const results = [];

      // 1. 抓取表格中所有行 (tr)
      const rows = Array.from(document.querySelectorAll('tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td, th'))
          .map(c => c.innerText.trim())
          .filter(Boolean);

        if (cells.length >= 2) {
          const fullRow = cells.join(' | ');
          if (/\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(fullRow)) {
            results.push({ text: fullRow });
          }
        }
      }

      // 2. 備用機制：若不是標準 <table> 標籤，改為按行讀取包含日期的文字區塊
      if (results.length === 0) {
        const lines = (document.body.innerText || '')
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (/\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(line) && line.length < 200 && line.length > 8) {
            results.push({ text: line });
          }
        }
      }

      return results;
    });

    await browser.close();
    return records;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// 記得在 module.exports 補上
module.exports = { fetchCPBLData, fetchRosterMovements };